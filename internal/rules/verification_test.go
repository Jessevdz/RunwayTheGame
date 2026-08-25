package rules

import "testing"

func TestVerificationValidation(t *testing.T) {
	for _, v := range []string{VerificationLLM, VerificationHost, VerificationTrust} {
		if !IsValidVerification(v) {
			t.Errorf("expected %q to be a valid grading mode", v)
		}
	}
	// Refused at creation rather than defaulted, for the same reason an unknown
	// game mode is: the near-misses here are the ones a host would plausibly
	// type, and every one of them means something different about where a
	// player's photo ends up.
	for _, v := range []string{"", "LLM", "ai", "manual", "gm", "none", "honour"} {
		if IsValidVerification(v) {
			t.Errorf("expected %q to be rejected as a grading mode", v)
		}
	}
}

func TestHostGradingIsRefusedInSoloModes(t *testing.T) {
	// A team race or a coin rush has somebody holding the host capability who is
	// not racing, so all three modes are available.
	for _, mode := range []string{ModeTeam, ModeCoinRush} {
		for _, v := range []string{VerificationLLM, VerificationHost, VerificationTrust} {
			if !VerificationAllowedInMode(v, mode) {
				t.Errorf("expected %q grading to be allowed in %q", v, mode)
			}
		}
	}

	// A solo runner holds their own host token, but the race shell never offers a
	// lone runner the host tools — so a run graded by "the host" is one whose
	// submissions nobody can ever clear. Time trials allow LLM or trust.
	if VerificationAllowedInMode(VerificationHost, ModeSoloTimeTrial) {
		t.Errorf("expected host grading to be refused in %q: nobody reads the queue", ModeSoloTimeTrial)
	}
	for _, v := range []string{VerificationLLM, VerificationTrust} {
		if !VerificationAllowedInMode(v, ModeSoloTimeTrial) {
			t.Errorf("expected %q grading to be allowed in %q", v, ModeSoloTimeTrial)
		}
	}

	// Casual solo mode has no referee at all: neither host nor LLM is allowed.
	for _, v := range []string{VerificationHost, VerificationLLM} {
		if VerificationAllowedInMode(v, ModeSoloCasual) {
			t.Errorf("expected %q grading to be refused in %q: casual runs have no referee", v, ModeSoloCasual)
		}
	}
	if !VerificationAllowedInMode(VerificationTrust, ModeSoloCasual) {
		t.Errorf("expected %q grading to be allowed in %q", VerificationTrust, ModeSoloCasual)
	}

	// An unrecognised grading mode is not allowed anywhere, whatever the game
	// mode — the validity check comes first.
	if VerificationAllowedInMode("manual", ModeTeam) {
		t.Error("expected an unknown grading mode to be refused even in a team race")
	}
}

func TestNormalizeRulesetVerification(t *testing.T) {
	// A game stored before the field existed unmarshals as "", and the model is
	// what it was actually played under.
	if got := NormalizeRuleset(Ruleset{}).Verification; got != VerificationLLM {
		t.Errorf("expected an unset grading mode to default to %q, got %q", VerificationLLM, got)
	}

	// Every valid choice survives normalization untouched. This is the one that
	// would break silently: a host who chose to keep photos in-house must not
	// have that repaired into sending them out.
	for _, v := range []string{VerificationLLM, VerificationHost, VerificationTrust} {
		if got := NormalizeRuleset(Ruleset{Verification: v}).Verification; got != v {
			t.Errorf("expected %q to survive normalization, got %q", v, got)
		}
	}

	// A stored value that is not a mode at all can only come from a hand-edited
	// row or a rolled-back deployment. It fails to host grading, which stalls a
	// queue visibly — reading it as "llm" would resolve a corrupted setting by
	// disclosing photos, which is the one direction that cannot be undone.
	if got := NormalizeRuleset(Ruleset{Verification: "manual"}).Verification; got != VerificationHost {
		t.Errorf("expected an unknown stored grading mode to fail to %q, got %q", VerificationHost, got)
	}
}
