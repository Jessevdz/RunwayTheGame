# Verification Package

This package (`internal/verification`) contains the automated evidence verification engine for **Codename Runway**. It processes submitted capture photos using Scaleway Generative APIs (multimodal LLMs such as Qwen 3.5 Vision) alongside EXIF/GPS velocity heuristics.

---

## Directory Overview

- **`types.go`**: Core verification data contracts (`ScalewayResponse`, `VerificationJobPayload`, `VerificationJobDetails`, `SubmissionVerdict`).
- **`scaleway.go`**: Client wrapper for Scaleway Generative APIs and Gemini endpoints (`/v1/chat/completions`) supporting base64 image payloads and structured JSON response parsing.
- **`heuristics.go`**: Geolocation accuracy, timestamp consistency, and velocity checks.
- **`worker.go`**: Outbox job worker loop reading verification jobs and dispatching verdict commands to `POST /api/games/{game_id}/verdict`.
- **`scaleway_test.go`**: Unit tests for model selection and referee prompt formatting.
- **`grading_gate_test.go`**: Integration tests for rubric criteria validation and confidence thresholds.
- **`heuristics_bypass_test.go`**: Tests for EXIF and velocity anti-spoof checks.
- **`worker_test.go`**: Outbox worker polling, retry, and escalation behavior tests.

---

## Model Overrides & Supported Providers

By default, the client uses `qwen/qwen3.5-397b-a17b:int4` via Scaleway. You can configure provider credentials, models, and endpoints using environment variables:

```bash
# Scaleway Configuration
export SCALEWAY_API_KEY="your-scaleway-key"            # or SCW_SECRET_KEY
export SCALEWAY_BASE_URL="https://api.scaleway.ai/v1"  # default
export SCALEWAY_MODEL="qwen/qwen3.5-397b-a17b:int4"    # default
export SCALEWAY_SECOND_PASS_MODEL="qwen/qwen3.5-397b-a17b:int4"

# Alternative / Gemini Configuration
export GEMINI_API_KEY="your-gemini-key"
export GEMINI_MODEL="gemini-1.5-pro"
export GEMINI_SECOND_PASS_MODEL="gemini-1.5-pro"
```

