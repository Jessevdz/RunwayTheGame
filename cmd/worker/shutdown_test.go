package main

import (
	"context"
	"testing"
	"time"
)

// fakeProcessor implements jobProcessor for testing runLoop execution.
type fakeProcessor struct {
	calls int
	fn    func(jobCtx context.Context, call int) (bool, error)
}

func (f *fakeProcessor) ProcessNextJob(jobCtx context.Context) (bool, error) {
	f.calls++
	return f.fn(jobCtx, f.calls)
}

// TestRunLoopStopsPromptlyWhileIdle verifies that runLoop terminates immediately
// upon context cancellation when idle.
func TestRunLoopStopsPromptlyWhileIdle(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	polled := make(chan struct{}, 1)
	p := &fakeProcessor{fn: func(context.Context, int) (bool, error) {
		select {
		case polled <- struct{}{}:
		default:
		}
		return false, nil // nothing in the queue
	}}

	done := make(chan struct{})
	go func() {
		runLoop(ctx, p, time.Minute)
		close(done)
	}()

	<-polled
	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("runLoop did not return on cancellation — it is waiting out the poll interval")
	}
}

// TestRunLoopLetsAJobInFlightFinish verifies that an in-flight job completes
// cleanly after cancellation rather than being aborted mid-execution.
func TestRunLoopLetsAJobInFlightFinish(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	started := make(chan struct{})
	var jobWasCancelled bool

	p := &fakeProcessor{fn: func(jobCtx context.Context, call int) (bool, error) {
		if call > 1 {
			t.Errorf("runLoop took a second job after the shutdown signal (call %d)", call)
			return false, nil
		}
		close(started)
		<-ctx.Done() // wait for cancellation while the job is in flight
		jobWasCancelled = jobCtx.Err() != nil
		return true, nil
	}}

	done := make(chan struct{})
	go func() {
		runLoop(ctx, p, time.Millisecond)
		close(done)
	}()

	<-started
	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("runLoop did not return once the in-flight job finished")
	}

	if jobWasCancelled {
		t.Error("the shutdown signal cancelled a job in flight, stranding it in 'running'")
	}
	if p.calls != 1 {
		t.Errorf("expected exactly one job, got %d", p.calls)
	}
}
