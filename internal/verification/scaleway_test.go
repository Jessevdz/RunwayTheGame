package verification

import (
	"os"
	"strings"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

func TestSelectModelDefaultsToQwen(t *testing.T) {
	os.Unsetenv("SCALEWAY_MODEL")
	os.Unsetenv("SCALEWAY_SECOND_PASS_MODEL")
	os.Unsetenv("GEMINI_MODEL")
	os.Unsetenv("GEMINI_SECOND_PASS_MODEL")

	firstPass := selectModel("")
	secondPass := selectModel("the player objects: I was clearly at the summit")

	if firstPass != "qwen/qwen3.5-397b-a17b:int4" {
		t.Errorf("expected first-pass default model to be qwen/qwen3.5-397b-a17b:int4, got %q", firstPass)
	}
	if secondPass != "qwen/qwen3.5-397b-a17b:int4" {
		t.Errorf("expected second-pass default model to be qwen/qwen3.5-397b-a17b:int4, got %q", secondPass)
	}
}

// TestRefereeInstructionOmitsEmptyRubricSections verifies that empty rubric sections are omitted from referee instructions.
func TestRefereeInstructionOmitsEmptyRubricSections(t *testing.T) {
	instruction := buildRefereeInstruction("Photograph a wild bird", rules.RubricDetail{})

	for _, heading := range []string{"MUST SHOW", "FAILS IF", "ACCEPTABLE AMBIGUITY", "rubric below"} {
		if strings.Contains(instruction, heading) {
			t.Errorf("expected no %q section for an empty rubric, got:\n%s", heading, instruction)
		}
	}
	if !strings.Contains(instruction, "Photograph a wild bird") {
		t.Errorf("expected the challenge prompt to survive, got:\n%s", instruction)
	}
	if !strings.Contains(instruction, "Judge the photo against that prompt alone") {
		t.Errorf("expected the prompt-only standard, got:\n%s", instruction)
	}
}

func TestRefereeInstructionKeepsFilledRubricSections(t *testing.T) {
	instruction := buildRefereeInstruction("Photograph a wild bird", rules.RubricDetail{
		MustShow:            []string{"a bird", "   "},
		FailsIf:             []string{},
		AcceptableAmbiguity: "  ",
	})

	if !strings.Contains(instruction, `- MUST SHOW: ["a bird"]`) {
		t.Errorf("expected the filled MUST SHOW entries, got:\n%s", instruction)
	}
	for _, heading := range []string{"FAILS IF", "ACCEPTABLE AMBIGUITY"} {
		if strings.Contains(instruction, heading) {
			t.Errorf("expected no %q section when it holds only blanks, got:\n%s", heading, instruction)
		}
	}
}

func TestSelectModelRespectsEnvOverrides(t *testing.T) {
	os.Setenv("SCALEWAY_MODEL", "custom-first-pass")
	os.Setenv("SCALEWAY_SECOND_PASS_MODEL", "custom-second-pass")
	defer os.Unsetenv("SCALEWAY_MODEL")
	defer os.Unsetenv("SCALEWAY_SECOND_PASS_MODEL")

	if got := selectModel(""); got != "custom-first-pass" {
		t.Errorf("expected env override for first pass, got %q", got)
	}
	if got := selectModel("objection"); got != "custom-second-pass" {
		t.Errorf("expected env override for second pass, got %q", got)
	}
}
