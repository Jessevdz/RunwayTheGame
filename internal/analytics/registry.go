package analytics

// Registry defines registered events and their allowed properties.
var Registry = map[string]EventSpec{
	"app.surface_opened": {Props: map[string]PropSpec{
		"surface":  {Kind: KindEnum, Values: surfaces},
		"viewport": {Kind: KindEnum, Values: viewports},
	}},
	"app.design_unavailable": {Props: map[string]PropSpec{
		"viewport": {Kind: KindEnum, Values: viewports},
	}},
	"app.request_failed": {Props: map[string]PropSpec{
		"route":  {Kind: KindEnum, Values: routeShapes},
		"status": {Kind: KindEnum, Values: httpStatuses},
	}},

	"editor.session_started": {Props: map[string]PropSpec{
		"mode": {Kind: KindEnum, Values: []string{"new", "existing", "readonly"}},
	}},
	"editor.session_ended": {Props: map[string]PropSpec{
		"duration":  {Kind: KindEnum, Values: durations},
		"saved":     {Kind: KindBool},
		"dirty":     {Kind: KindBool},
		"waypoints": {Kind: KindBucket},
	}},
	"editor.waypoint_added":    {},
	"editor.waypoint_moved":    {},
	"editor.waypoint_deleted":  {},
	"editor.waypoint_selected": {},
	"editor.road_added":        {},
	"editor.road_deleted":      {},
	"editor.start_set":         {},
	"editor.finish_set":        {},
	"editor.action_cancelled":  {},
	"editor.tool_selected": {Props: map[string]PropSpec{
		"tool": {Kind: KindEnum, Values: editorTools},
		"via":  {Kind: KindEnum, Values: []string{"click", "key"}},
	}},
	"editor.tab_opened": {Props: map[string]PropSpec{
		"tab": {Kind: KindEnum, Values: editorTabs},
	}},
	"editor.challenge_edited": {Props: map[string]PropSpec{
		"field": {Kind: KindEnum, Values: []string{
			"prompt", "must_show", "fails_if", "acceptable_ambiguity",
			"coin_reward", "veto_penalty",
		}},
	}},
	"editor.powerup_edited": {Props: map[string]PropSpec{
		"field": {Kind: KindEnum, Values: []string{
			"cost", "duration", "effect", "name", "icon", "description",
			"enabled", "order",
		}},
	}},
	"editor.confirm_shown": {Props: map[string]PropSpec{
		"subject": {Kind: KindEnum, Values: confirmSubjects},
	}},
	"editor.confirm_resolved": {Props: map[string]PropSpec{
		"subject": {Kind: KindEnum, Values: confirmSubjects},
		"outcome": {Kind: KindEnum, Values: []string{"confirmed", "cancelled"}},
	}},
	"editor.import_attempted": {Props: map[string]PropSpec{
		"result": {Kind: KindEnum, Values: []string{"ok", "parse_error", "shape_error"}},
	}},
	"editor.export_performed": {},

	"board.saved": {Props: map[string]PropSpec{
		"result":          {Kind: KindEnum, Values: []string{"created", "updated", "failed"}},
		"waypoints":       {Kind: KindBucket},
		"roads":           {Kind: KindBucket},
		"challenges":      {Kind: KindBucket},
		"roadblock_cards": {Kind: KindBucket},
		"curse_cards":     {Kind: KindBucket},
		"powerups":        {Kind: KindBucket},
		"has_start":       {Kind: KindBool},
		"has_finish":      {Kind: KindBool},
		"has_rubrics":     {Kind: KindBool},
	}},
	"board.forked": {},
	"board.listed": {Props: map[string]PropSpec{
		"listed": {Kind: KindBool},
	}},
	"board.published": {Props: map[string]PropSpec{
		"result": {Kind: KindEnum, Values: []string{"ok", "rejected"}},
	}},
	"board.share_copied": {Props: map[string]PropSpec{
		"link": {Kind: KindEnum, Values: []string{"view", "edit"}},
	}},
	"board.validation_issue": {Props: map[string]PropSpec{
		"code":     {Kind: KindEnum, Values: ValidationCodes},
		"severity": {Kind: KindEnum, Values: []string{"error", "warning"}},
		"source":   {Kind: KindEnum, Values: []string{"client", "server"}},
	}},
	"board.race_launched": {Props: map[string]PropSpec{
		"mode": {Kind: KindEnum, Values: RaceModes},
	}},

	"deck.editor_opened": {Props: map[string]PropSpec{"deck": {Kind: KindEnum, Values: decks}}},
	"deck.card_added":    {Props: map[string]PropSpec{"deck": {Kind: KindEnum, Values: decks}}},
	"deck.card_removed":  {Props: map[string]PropSpec{"deck": {Kind: KindEnum, Values: decks}}},
}

var (
	viewports = []string{"mobile", "tablet", "desktop"}

	surfaces = []string{
		"landing", "gallery", "roadmap", "admin", "design",
		"races", "host", "lobby", "solo", "race", "report",
	}

	durations = []string{"under_1m", "1_5m", "5_15m", "15_60m", "over_60m"}

	editorTools = []string{"select", "waypoint", "road", "start", "finish", "delete"}

	editorTabs = []string{"elements", "challenges", "decks", "powerups", "validation"}

	confirmSubjects = []string{"delete_waypoint", "delete_road", "finish_role"}

	decks = []string{"roadblock", "curse"}

	routeShapes = []string{
		"boards.create", "boards.update", "boards.get", "boards.list",
		"boards.publish", "boards.validate", "boards.visibility", "boards.fork",
		"boards.delete", "boards.decks", "boards.challenges",
		"games.create", "games.get", "games.join", "games.report",
		"games.submission", "games.position", "games.powerup",
		"config", "leaderboard", "roadmap",
	}

	httpStatuses = []string{
		"0", "400", "401", "403", "404", "409", "413", "429",
		"500", "502", "503",
	}
)

// RaceModes defines allowed race modes.
var RaceModes = []string{"team", "solo_time_trial", "solo_casual", "coin_rush"}

// ValidationCodes defines shared board validation code values.
var ValidationCodes = []string{
	"no_waypoints",
	"start_count",
	"finish_count",
	"start_is_finish",
	"waypoint_isolated",
	"waypoint_unreachable",
	"finish_unreachable",
	"finish_has_challenge",
	"waypoint_radius_range",
	"challenge_coins_range",
	"challenge_veto_range",
	"roads_cross",
	"challenge_prompt_empty",
	"challenge_missing",
	"deck_roadblock_empty",
	"deck_curse_empty",
}
