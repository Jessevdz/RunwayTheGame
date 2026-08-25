package logger

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type contextKey string

const traceIDKey contextKey = "trace_id"

// WithTrace returns a new context with the given trace ID.
func WithTrace(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey, traceID)
}

// GetTraceID retrieves the trace ID from context.
func GetTraceID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v := ctx.Value(traceIDKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

type LogLevel string

const (
	LevelDebug LogLevel = "DEBUG"
	LevelInfo  LogLevel = "INFO"
	LevelWarn  LogLevel = "WARN"
	LevelError LogLevel = "ERROR"
)

type logEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     LogLevel               `json:"level"`
	Message   string                 `json:"message"`
	TraceID   string                 `json:"trace_id,omitempty"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
}

func logJSON(ctx context.Context, level LogLevel, msg string, fields map[string]interface{}) {
	traceID := GetTraceID(ctx)
	entry := logEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Level:     level,
		Message:   msg,
		TraceID:   traceID,
		Fields:    fields,
	}
	data, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal log entry: %v\n", err)
		return
	}
	fmt.Fprintln(os.Stdout, string(data))
}

// Debug logs a message at LevelDebug.
func Debug(ctx context.Context, msg string, fields map[string]interface{}) {
	logJSON(ctx, LevelDebug, msg, fields)
}

// Info logs a message at LevelInfo.
func Info(ctx context.Context, msg string, fields map[string]interface{}) {
	logJSON(ctx, LevelInfo, msg, fields)
}

// Warn logs a message at LevelWarn.
func Warn(ctx context.Context, msg string, fields map[string]interface{}) {
	logJSON(ctx, LevelWarn, msg, fields)
}

// Error logs a message at LevelError.
func Error(ctx context.Context, msg string, fields map[string]interface{}) {
	logJSON(ctx, LevelError, msg, fields)
}
