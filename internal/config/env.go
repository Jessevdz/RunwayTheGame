// Package config reads process configuration from the environment. It is the
// one place the "read this variable, fall back to this default" rule lives, so
// the server, the worker, and the test harness cannot drift apart on what an
// unset or unparseable variable means.
package config

import (
	"os"
	"strconv"
)

// EnvOr returns the value of the environment variable key, or fallback when it
// is unset or empty.
func EnvOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// EnvIntOr returns the value of the environment variable key parsed as an int.
// An unset, empty, or unparseable value yields fallback: a typo in a port
// number starts the process on its default rather than failing to start.
func EnvIntOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
