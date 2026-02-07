package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/allcallall/backend/internal/handlers"
)

// RouteDependencies 路由所需依赖
// RouteDependencies bundles handlers and middleware.
type RouteDependencies struct {
	AuthHandler      *handlers.AuthHandler
	EmailHandler     *handlers.EmailHandler
	UserHandler      *handlers.UserHandler
	RecordingHandler *handlers.RecordingHandler
	SignalingHandler *handlers.SignalingHandler
	WebRTCHandler    *handlers.WebRTCHandler
	AuthMiddleware   gin.HandlerFunc
}

// RegisterRoutes 注册所有 HTTP 路由
// RegisterRoutes wires handlers into the Gin engine.
func RegisterRoutes(router *gin.Engine, deps RouteDependencies) {
	// 统一 API 前缀
	api := router.Group("/api/v1")

	// 健康检查（不需要鉴权）
	api.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 公开接口：注册/登录
	authGroup := api.Group("/auth")
	deps.AuthHandler.RegisterRoutes(authGroup)

	// 公开接口：邮箱验证码
	emailGroup := api.Group("")
	deps.EmailHandler.RegisterRoutes(emailGroup)

	// 受保护接口：统一鉴权
	protected := api.Group("/")
	protected.Use(deps.AuthMiddleware)
	{
		// 用户相关接口（联系人、通话记录等）
		userGroup := protected.Group("/users")
		deps.UserHandler.RegisterRoutes(userGroup)
		if deps.RecordingHandler != nil {
			deps.RecordingHandler.RegisterRoutes(userGroup)
		}
		// 信令 WebSocket 入口
		protected.GET("/ws", deps.SignalingHandler.Handle)
		// WebRTC 配置下发（可选）
		if deps.WebRTCHandler != nil {
			deps.WebRTCHandler.RegisterRoutes(protected)
		}
	}
}
