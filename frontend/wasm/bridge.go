package main

import (
	"errors"
	"sync"
	"syscall/js"
)

// A scope owns all callbacks and asynchronous bridge operations of one SSH connection
type jsBinding struct {
	object js.Value
	name   string
	fn     js.Func
}

type bridgeError struct {
	cause         error
	temporaryPath string
	uncertain     bool
}

func (e *bridgeError) Error() string { return e.cause.Error() }

type jsScope struct {
	mu       sync.Mutex
	closed   bool
	bindings []jsBinding
	cleanup  []func()
	pending  sync.WaitGroup
}

func (s *jsScope) bind(object js.Value, name string, callback func(js.Value, []js.Value) any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	fn := js.FuncOf(callback)
	s.bindings = append(s.bindings, jsBinding{object, name, fn})
	object.Set(name, fn)
}

func (s *jsScope) onClose(cleanup func()) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		go cleanup()
		return
	}
	s.cleanup = append(s.cleanup, cleanup)
	s.mu.Unlock()
}

func (s *jsScope) promise(fn func() (any, error)) js.Value {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return jsPromise(func() (any, error) { return nil, errors.New("SFTP_CLOSED") })
	}
	s.pending.Add(1)
	s.mu.Unlock()
	return jsPromise(func() (any, error) {
		defer s.pending.Done()
		return fn()
	})
}

func (s *jsScope) dispose() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	bindings, cleanup := s.bindings, s.cleanup
	s.bindings, s.cleanup = nil, nil
	s.mu.Unlock()
	for _, binding := range bindings {
		if binding.object.Get(binding.name).Equal(binding.fn.Value) {
			binding.object.Set(binding.name, js.Undefined())
		}
	}
	go func() {
		for _, close := range cleanup {
			close()
		}
		s.pending.Wait()
		for _, binding := range bindings {
			binding.fn.Release()
		}
	}()
}

// Promise invokes its executor synchronously, the executor must not retain each chunk
func jsPromise(fn func() (any, error)) js.Value {
	executor := js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			result, err := fn()
			if err != nil {
				value := js.Global().Get("Error").New(err.Error())
				var detail *bridgeError
				if errors.As(err, &detail) {
					value.Set("temporaryPath", detail.temporaryPath)
					value.Set("uncertain", detail.uncertain)
				}
				reject.Invoke(value)
			} else {
				resolve.Invoke(result)
			}
		}()
		return nil
	})
	defer executor.Release()
	return js.Global().Get("Promise").New(executor)
}
