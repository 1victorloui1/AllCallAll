package models

import "time"

// ChatMessage stores a persisted chat message between two users.
type ChatMessage struct {
	ID                  uint64    `gorm:"primaryKey;autoIncrement"`
	SenderID            uint64    `gorm:"not null;index"`
	SenderEmail         string    `gorm:"size:255;not null;index"`
	SenderDisplayName   string    `gorm:"size:100"`
	ReceiverID          uint64    `gorm:"not null;index"`
	ReceiverEmail       string    `gorm:"size:255;not null;index"`
	ReceiverDisplayName string    `gorm:"size:100"`
	Body                string    `gorm:"type:text;not null"`
	SentAt              time.Time `gorm:"not null;index"`
	CreatedAt           time.Time `gorm:"autoCreateTime"`
	UpdatedAt           time.Time `gorm:"autoUpdateTime"`
}

// TableName specifies database table name.
func (ChatMessage) TableName() string {
	return "chat_messages"
}
