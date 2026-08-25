package projections

import "testing"

// TestRoadblockBlocksTeam verifies roadblock blocking rules for placing and clearing teams.
func TestRoadblockBlocksTeam(t *testing.T) {
	for _, tc := range []struct {
		name      string
		roadblock Roadblock
		teamID    string
		want      bool
	}{
		{
			name:      "no roadblock on the road",
			roadblock: Roadblock{},
			teamID:    "red",
			want:      false,
		},
		{
			name:      "the team that placed it is never blocked by its own card",
			roadblock: Roadblock{RoadID: "s1", PlacedBy: "red"},
			teamID:    "red",
			want:      false,
		},
		{
			name:      "nobody has cleared it yet",
			roadblock: Roadblock{RoadID: "s1", PlacedBy: "red"},
			teamID:    "blue",
			want:      true,
		},
		{
			name:      "this team cleared it",
			roadblock: Roadblock{RoadID: "s1", PlacedBy: "red", ClearedBy: map[string]bool{"blue": true}},
			teamID:    "blue",
			want:      false,
		},
		{
			name:      "another team cleared it",
			roadblock: Roadblock{RoadID: "s1", PlacedBy: "red", ClearedBy: map[string]bool{"blue": true}},
			teamID:    "green",
			want:      false,
		},
		{
			name:      "a cleared-by entry that is false clears nothing",
			roadblock: Roadblock{RoadID: "s1", PlacedBy: "red", ClearedBy: map[string]bool{"blue": false}},
			teamID:    "green",
			want:      true,
		},
	} {
		if got := tc.roadblock.BlocksTeam(tc.teamID); got != tc.want {
			t.Errorf("%s: BlocksTeam(%q) = %t, want %t", tc.name, tc.teamID, got, tc.want)
		}
	}
}
