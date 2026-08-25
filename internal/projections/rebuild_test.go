package projections

import (
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// TestEveryFoldIsRegisteredUnderAnEventTypeTheStoreAccepts verifies that all registered fold event types match known event store types.
func TestEveryFoldIsRegisteredUnderAnEventTypeTheStoreAccepts(t *testing.T) {
	for eventType := range folds {
		if !eventstore.KnownEventType(eventType) {
			t.Errorf("a fold is registered for %q, which the event store will not accept — check the spelling in the folds table", eventType)
		}
	}
}
