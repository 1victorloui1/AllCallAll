package models

import "time"

// CallLog stores per-user call history.
// CallLog 记录通话记录（每个用户一条）
type CallLog struct {
	ID              uint64     `gorm:"primaryKey;autoIncrement"`
	CallID          string     `gorm:"size:64;index;uniqueIndex:idx_call_user"`
	UserID          uint64     `gorm:"not null;index;uniqueIndex:idx_call_user"`
	UserEmail       string     `gorm:"size:255;not null;index"`
	PeerID          uint64     `gorm:"not null;index"`
	PeerEmail       string     `gorm:"size:255;not null;index"`
	PeerDisplayName string     `gorm:"size:100"`
	Direction       string     `gorm:"size:20;not null;index"` // outgoing | incoming
	Status          string     `gorm:"size:20;not null;index"` // pending | answered | missed
	StartedAt       time.Time  `gorm:"not null;index"`
	AnsweredAt      *time.Time `gorm:"index"`
	EndedAt         *time.Time `gorm:"index"`
	CreatedAt       time.Time  `gorm:"autoCreateTime"`
	UpdatedAt       time.Time  `gorm:"autoUpdateTime"`
}

// TableName specifies database table name.
func (CallLog) TableName() string {
	return "call_logs"
}
