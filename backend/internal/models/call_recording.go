package models

import (
	"time"

	"gorm.io/datatypes"
)

// CallRecording stores recording/transcript/summary for a call (owner only).
// CallRecording 记录通话录音与转写结果（仅录音发起者可见）。
type CallRecording struct {
	ID                   uint64         `gorm:"primaryKey;autoIncrement"`
	CallID               string         `gorm:"size:64;index;uniqueIndex:idx_call_owner"`
	OwnerUserID          uint64         `gorm:"not null;index;uniqueIndex:idx_call_owner"`
	OwnerEmail           string         `gorm:"size:255;not null;index"`
	PeerEmail            string         `gorm:"size:255;not null;index"`
	Status               string         `gorm:"size:20;not null;index"`
	TargetLang           string         `gorm:"size:10;not null"`
	OwnerAudioPath       string         `gorm:"size:512"`
	PeerAudioPath        string         `gorm:"size:512"`
	TranscriptJSON       datatypes.JSON `gorm:"type:json"`
	SummaryText          string         `gorm:"type:text"`
	TranslatedTranscript string         `gorm:"type:text"`
	TranslatedSummary    string         `gorm:"type:text"`
	ErrorMessage         string         `gorm:"type:text"`
	CreatedAt            time.Time      `gorm:"autoCreateTime"`
	UpdatedAt            time.Time      `gorm:"autoUpdateTime"`
}

// TableName specifies database table name.
func (CallRecording) TableName() string {
	return "call_recordings"
}
