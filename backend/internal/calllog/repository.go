package calllog

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/allcallall/backend/internal/models"
)

// Repository manages call log persistence.
// Repository 负责通话记录的持久化读写。
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository.
// NewRepository 创建通话记录仓储实例。
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// CreateMany inserts call logs with idempotency.
// CreateMany 批量写入通话记录，使用幂等插入避免重复。
func (r *Repository) CreateMany(ctx context.Context, records []*models.CallLog) error {
	// 空输入直接返回，避免无意义的写入。
	if len(records) == 0 {
		return nil
	}
	// 冲突时不更新，保证同一 call_id 的记录不会重复写入。
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&records).
		Error
}

// ListByUserID returns recent call logs for a user.
// ListByUserID 获取用户最近的通话记录列表。
func (r *Repository) ListByUserID(ctx context.Context, userID uint64, limit int) ([]models.CallLog, error) {
	// 未指定或不合法的 limit 时使用默认值。
	if limit <= 0 {
		limit = 50
	}

	var logs []models.CallLog
	// 按开始时间倒序返回指定数量的记录。
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("started_at desc").
		Limit(limit).
		Find(&logs).
		Error
	return logs, err
}

// UpdateByCallID updates call logs by call ID.
// UpdateByCallID 根据 call_id 更新对应记录。
func (r *Repository) UpdateByCallID(ctx context.Context, callID string, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).
		Model(&models.CallLog{}).
		Where("call_id = ?", callID).
		Updates(updates).
		Error
}

// UpdateByCallIDAndStatus updates call logs by call ID and status.
// UpdateByCallIDAndStatus 根据 call_id + status 精确更新记录，避免误更新。
func (r *Repository) UpdateByCallIDAndStatus(ctx context.Context, callID, status string, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).
		Model(&models.CallLog{}).
		Where("call_id = ? AND status = ?", callID, status).
		Updates(updates).
		Error
}

// GetByCallIDAndUserID returns a single call log for a user and call ID.
// GetByCallIDAndUserID 根据 call_id + user_id 获取通话记录。
func (r *Repository) GetByCallIDAndUserID(ctx context.Context, callID string, userID uint64) (*models.CallLog, error) {
	var log models.CallLog
	err := r.db.WithContext(ctx).
		Where("call_id = ? AND user_id = ?", callID, userID).
		Take(&log).
		Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}
