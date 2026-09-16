package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sync"
	"syscall/js"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type remoteFile struct {
	file      *sftp.File
	target    string
	temporary string
	original  os.FileInfo
	mode      os.FileMode
	closed    bool
}

type sftpBridge struct {
	client *sftp.Client
	mu     sync.Mutex
	files  map[int]*remoteFile
	nextID int
	closed bool
}

func fileInfo(info os.FileInfo) map[string]interface{} {
	return map[string]interface{}{
		"name": info.Name(), "isDir": info.IsDir(), "isLink": info.Mode()&os.ModeSymlink != 0,
		"size": info.Size(), "modTime": info.ModTime().UnixMilli(), "permissions": info.Mode().String(),
	}
}

func (b *sftpBridge) get(id int) (*remoteFile, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil, errors.New("SFTP_CLOSED")
	}
	f := b.files[id]
	if f == nil {
		return nil, errors.New("SFTP_INVALID_HANDLE")
	}
	return f, nil
}

func (b *sftpBridge) add(file *remoteFile) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		file.file.Close()
		return 0, errors.New("SFTP_CLOSED")
	}
	b.nextID++
	b.files[b.nextID] = file
	return b.nextID, nil
}

func (b *sftpBridge) forget(id int) {
	b.mu.Lock()
	delete(b.files, id)
	b.mu.Unlock()
}

func (b *sftpBridge) failedTemporary(file *sftp.File, temporary string, cause error) error {
	if file != nil {
		file.Close()
	}
	if err := b.client.Remove(temporary); err != nil && !os.IsNotExist(err) {
		return &bridgeError{cause: cause, temporaryPath: temporary}
	}
	return cause
}

func (b *sftpBridge) close() {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	b.files = make(map[int]*remoteFile)
	b.mu.Unlock()
	// Closing this subsystem wakes its pending requests without closing the SSH shell
	b.client.Close()
}

func sameFile(a, b os.FileInfo) bool {
	return a.Size() == b.Size() && a.ModTime().Equal(b.ModTime()) && a.Mode() == b.Mode()
}

// Local pipes can be closed immediately even when a remote SFTP server stops responding
type sftpTransport struct {
	reader *io.PipeReader
	writer *io.PipeWriter
}

func (t *sftpTransport) Read(p []byte) (int, error)  { return t.reader.Read(p) }
func (t *sftpTransport) Write(p []byte) (int, error) { return t.writer.Write(p) }
func (t *sftpTransport) Close() error {
	t.reader.CloseWithError(io.ErrClosedPipe)
	return t.writer.CloseWithError(io.ErrClosedPipe)
}

func removeTree(client *sftp.Client, target string) error {
	info, err := client.Lstat(target)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return client.Remove(target)
	}
	files, err := client.ReadDir(target)
	if err != nil {
		return err
	}
	for _, file := range files {
		name := file.Name()
		if name == "." || name == ".." || path.Base(name) != name {
			return errors.New("SFTP_INVALID_PATH")
		}
		if err := removeTree(client, path.Join(target, name)); err != nil {
			return err
		}
	}
	return client.RemoveDirectory(target)
}

func initSFTP(client *ssh.Client, scope *jsScope, config js.Value) {
	status := func(state, message string) {
		if callback := config.Get("onSftpState"); callback.Type() == js.TypeFunction {
			callback.Invoke(state, message)
		}
	}
	status("initializing", "")
	subsystem, err := client.NewSession()
	if err != nil {
		status("error", err.Error())
		return
	}
	// Install cancellation before requesting the subsystem, including initialization stalls
	scope.onClose(func() { subsystem.Close() })
	scope.bind(config, "sftpAbort", func(this js.Value, args []js.Value) any {
		status("error", "SFTP_INTERRUPTED")
		go subsystem.Close()
		return nil
	})
	stdin, err := subsystem.StdinPipe()
	if err != nil {
		subsystem.Close()
		status("error", err.Error())
		return
	}
	stdout, err := subsystem.StdoutPipe()
	if err != nil {
		subsystem.Close()
		status("error", err.Error())
		return
	}
	if err = subsystem.RequestSubsystem("sftp"); err != nil {
		subsystem.Close()
		status("error", err.Error())
		return
	}
	readPipe, incoming := io.Pipe()
	outgoing, writePipe := io.Pipe()
	transport := &sftpTransport{reader: readPipe, writer: writePipe}
	scope.onClose(func() { transport.Close() })
	go func() { _, err := io.Copy(incoming, stdout); incoming.CloseWithError(err) }()
	go func() { _, err := io.Copy(stdin, outgoing); outgoing.CloseWithError(err) }()
	scope.bind(config, "sftpAbort", func(this js.Value, args []js.Value) any {
		transport.Close()
		status("error", "SFTP_INTERRUPTED")
		go subsystem.Close()
		return nil
	})
	clientSFTP, err := sftp.NewClientPipe(transport, transport, sftp.UseConcurrentWrites(true), sftp.MaxConcurrentRequestsPerFile(8))
	if err != nil {
		transport.Close()
		subsystem.Close()
		status("error", err.Error())
		return
	}
	b := &sftpBridge{client: clientSFTP, files: make(map[int]*remoteFile)}
	scope.onClose(b.close)
	scope.bind(config, "sftpAbort", func(this js.Value, args []js.Value) any {
		status("error", "SFTP_INTERRUPTED")
		transport.Close()
		go func() { b.close(); subsystem.Close() }()
		return nil
	})
	bind := func(name string, fn func([]js.Value) (any, error)) {
		scope.bind(config, name, func(this js.Value, args []js.Value) any {
			return scope.promise(func() (any, error) {
				b.mu.Lock()
				closed := b.closed
				b.mu.Unlock()
				if closed {
					return nil, errors.New("SFTP_CLOSED")
				}
				return fn(args)
			})
		})
	}
	bind("sftpList", func(args []js.Value) (any, error) {
		files, err := b.client.ReadDir(args[0].String())
		if err != nil {
			return nil, err
		}
		result := make([]interface{}, 0, len(files))
		for _, file := range files {
			result = append(result, fileInfo(file))
		}
		return result, nil
	})
	bind("sftpStat", func(args []js.Value) (any, error) {
		info, err := b.client.Lstat(args[0].String())
		if os.IsNotExist(err) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return fileInfo(info), nil
	})
	bind("sftpMkdir", func(args []js.Value) (any, error) { return nil, b.client.Mkdir(args[0].String()) })
	bind("sftpCreate", func(args []js.Value) (any, error) {
		f, err := b.client.OpenFile(args[0].String(), os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			return nil, err
		}
		return nil, f.Close()
	})
	bind("sftpRemove", func(args []js.Value) (any, error) {
		target := path.Clean(args[0].String())
		if target == "/" || target == "." {
			return nil, errors.New("SFTP_INVALID_PATH")
		}
		return nil, removeTree(b.client, target)
	})
	bind("sftpRename", func(args []js.Value) (any, error) { return nil, b.client.Rename(args[0].String(), args[1].String()) })
	bind("sftpOpenFile", func(args []js.Value) (any, error) {
		info, err := b.client.Stat(args[0].String())
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("SFTP_NOT_REGULAR")
		}
		f, err := b.client.Open(args[0].String())
		if err != nil {
			return nil, err
		}
		id, err := b.add(&remoteFile{file: f})
		return id, err
	})
	bind("sftpFstat", func(args []js.Value) (any, error) {
		f, err := b.get(args[0].Int())
		if err != nil {
			return nil, err
		}
		info, err := f.file.Stat()
		if err != nil {
			return nil, err
		}
		return fileInfo(info), nil
	})
	bind("sftpReadAt", func(args []js.Value) (any, error) {
		f, err := b.get(args[0].Int())
		if err != nil {
			return nil, err
		}
		length := args[2].Int()
		if length < 0 || length > 256*1024 {
			return nil, errors.New("SFTP_INVALID_CHUNK")
		}
		buffer := make([]byte, length)
		n, err := f.file.ReadAt(buffer, int64(args[1].Float()))
		if err != nil && err != io.EOF {
			return nil, err
		}
		data := js.Global().Get("Uint8Array").New(n)
		js.CopyBytesToJS(data, buffer[:n])
		return map[string]interface{}{"data": data, "eof": err == io.EOF}, nil
	})
	bind("sftpWriteAt", func(args []js.Value) (any, error) {
		f, err := b.get(args[0].Int())
		if err != nil {
			return nil, err
		}
		length := args[2].Length()
		if length > 256*1024 {
			return nil, errors.New("SFTP_INVALID_CHUNK")
		}
		buffer := make([]byte, length)
		js.CopyBytesToGo(buffer, args[2])
		n, err := f.file.WriteAt(buffer, int64(args[1].Float()))
		if err == nil && n != length {
			err = io.ErrShortWrite
		}
		return n, err
	})
	bind("sftpCloseFile", func(args []js.Value) (any, error) {
		id := args[0].Int()
		f, err := b.get(id)
		if err != nil {
			return nil, err
		}
		b.forget(id)
		if f.closed {
			return nil, nil
		}
		return nil, f.file.Close()
	})
	bind("sftpPrepareUpload", func(args []js.Value) (any, error) {
		target, overwrite := args[0].String(), args[1].Bool()
		original, err := b.client.Lstat(target)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if original != nil {
			if !original.Mode().IsRegular() {
				return nil, errors.New("SFTP_NOT_REGULAR")
			}
			if !overwrite {
				return nil, errors.New("SFTP_EXISTS")
			}
			if _, ok := b.client.HasExtension("posix-rename@openssh.com"); !ok {
				return nil, errors.New("SFTP_NO_ATOMIC_RENAME")
			}
		}
		if len(args) > 2 && args[2].Type() == js.TypeObject && !args[2].IsNull() {
			expected := args[2]
			if original == nil || original.Size() != int64(expected.Get("size").Float()) || original.ModTime().UnixMilli() != int64(expected.Get("modTime").Float()) {
				return nil, errors.New("SFTP_FILE_CHANGED")
			}
		}
		random := make([]byte, 16)
		if _, err := rand.Read(random); err != nil {
			return nil, err
		}
		temporary := path.Join(path.Dir(target), ".webssh-upload-"+hex.EncodeToString(random)+".part")
		f, err := b.client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			return nil, b.failedTemporary(nil, temporary, err)
		}
		created, err := f.Stat()
		if err != nil {
			return nil, b.failedTemporary(f, temporary, err)
		}
		if err := f.Chmod(0600); err != nil {
			return nil, b.failedTemporary(f, temporary, err)
		}
		id, err := b.add(&remoteFile{file: f, target: target, temporary: temporary, original: original, mode: created.Mode()})
		if err != nil {
			return nil, b.failedTemporary(nil, temporary, err)
		}
		return map[string]interface{}{"handle": id, "temporaryPath": temporary}, nil
	})
	bind("sftpCommitUpload", func(args []js.Value) (any, error) {
		id := args[0].Int()
		f, err := b.get(id)
		if err != nil {
			return nil, err
		}
		if f.temporary == "" {
			return nil, errors.New("SFTP_INVALID_HANDLE")
		}
		info, err := f.file.Stat()
		if err != nil {
			return nil, err
		}
		if info.Size() != int64(args[1].Float()) {
			return nil, errors.New("SFTP_SIZE_MISMATCH")
		}
		mode := f.mode
		if f.original != nil {
			mode = f.original.Mode()
			before, okBefore := f.original.Sys().(*sftp.FileStat)
			after, okAfter := info.Sys().(*sftp.FileStat)
			if okBefore && okAfter && (before.UID != after.UID || before.GID != after.GID) {
				if err := f.file.Chown(int(before.UID), int(before.GID)); err != nil {
					return nil, err
				}
			}
		}
		if err := f.file.Chmod(mode); err != nil {
			return nil, err
		}
		if err := f.file.Close(); err != nil {
			f.closed = true
			return nil, err
		}
		f.closed = true
		current, err := b.client.Lstat(f.target)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if f.original == nil && current != nil || f.original != nil && (current == nil || !sameFile(f.original, current)) {
			return nil, errors.New("SFTP_FILE_CHANGED")
		}
		if f.original == nil {
			err = b.client.Rename(f.temporary, f.target)
		} else {
			err = b.client.PosixRename(f.temporary, f.target)
		}
		if err != nil {
			var status *sftp.StatusError
			if errors.As(err, &status) || os.IsPermission(err) || os.IsNotExist(err) || os.IsExist(err) {
				return nil, err
			}
			b.forget(id)
			return nil, fmt.Errorf("SFTP_COMMIT_UNCERTAIN: %s", f.temporary)
		}
		b.forget(id)
		return nil, nil
	})
	bind("sftpAbortUpload", func(args []js.Value) (any, error) {
		id := args[0].Int()
		f, err := b.get(id)
		if err != nil {
			return nil, err
		}
		b.forget(id)
		if !f.closed {
			f.file.Close()
		}
		if f.temporary != "" {
			if err := b.client.Remove(f.temporary); err != nil && !os.IsNotExist(err) {
				return nil, err
			}
		}
		return nil, nil
	})
	status("ready", "")
}
