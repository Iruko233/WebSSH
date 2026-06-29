package model

type Server struct {
	ID            string `json:"id"`
	EncryptedData string `json:"encryptedData"`
	IV            string `json:"iv"`
}

type CreateServerRequest struct {
	EncryptedData string `json:"encryptedData" binding:"required"`
	IV            string `json:"iv" binding:"required"`
}

type UpdateServerRequest struct {
	EncryptedData string `json:"encryptedData,omitempty"`
	IV            string `json:"iv,omitempty"`
}
