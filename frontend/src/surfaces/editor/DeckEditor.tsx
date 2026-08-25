import React, { useState } from 'react';
import { DeckWorkshop } from './DeckWorkshop';
import { parseCard, DECK_META } from './deckCards';
import type { CardDraft, DeckKind } from './deckCards';
import { Button, Empty } from '@ds';
import { IconDeck } from './components/EditorIcons';

export type { CardDraft, DeckKind } from './deckCards';

interface DeckEditorProps {
  roadblockCards: CardDraft[];
  curseCards: CardDraft[];
  isEditable: boolean;
  onChangeRoadblocks: (updated: CardDraft[]) => void;
  onChangeCurses: (updated: CardDraft[]) => void;
}

export const DeckEditor: React.FC<DeckEditorProps> = ({
  roadblockCards,
  curseCards,
  isEditable,
  onChangeRoadblocks,
  onChangeCurses
}) => {
  const [workshopDeck, setWorkshopDeck] = useState<DeckKind | null>(null);

  const decks: { kind: DeckKind; cards: CardDraft[] }[] = [
    { kind: 'roadblock', cards: roadblockCards },
    { kind: 'curse', cards: curseCards }
  ];

  const total = roadblockCards.length + curseCards.length;

  return (
    <div className="deck-summary">
      <span className="t-label">CARD DECKS</span>
      <p className="deck-summary__hint">
        Build the roadblock and curse decks players draw from. The workshop opens them as a card
        grid.
      </p>

      {total === 0 ? (
        <Empty
          icon={<IconDeck />}
          title="No cards yet"
          description="Both decks are empty. Open the workshop to start from the shipped sets or write your own."
          action={
            <Button variant="primary" icon={<IconDeck />} onClick={() => setWorkshopDeck('roadblock')}>
              Open Deck Workshop
            </Button>
          }
        />
      ) : (
        <>
          <div className="deck-summary__decks">
            {decks.map(({ kind, cards }) => {
              const meta = DECK_META[kind];
              const preview = cards.slice(0, 3);
              return (
                <button
                  key={kind}
                  className={`deck-summary__deck deck-summary__deck--${kind}`}
                  onClick={() => setWorkshopDeck(kind)}
                  title={`Open ${meta.label} in the Deck Workshop`}
                >
                  <div className="deck-summary__deck-head">
                    <span className="deck-summary__deck-name">
                      <meta.Icon />
                      <span>{meta.label}</span>
                    </span>
                    <span className="deck-summary__count">{cards.length}</span>
                  </div>
                  {preview.length > 0 ? (
                    <ul className="deck-summary__preview">
                      {preview.map((c) => {
                        const { title, description } = parseCard(c.text);
                        return <li key={c.id}>{title || description || 'Untitled card'}</li>;
                      })}
                      {cards.length > preview.length && (
                        <li className="deck-summary__more">+{cards.length - preview.length} more…</li>
                      )}
                    </ul>
                  ) : (
                    <ul className="deck-summary__preview">
                      <li className="deck-summary__more">Empty — open to fill it</li>
                    </ul>
                  )}
                </button>
              );
            })}
          </div>

          <Button
            variant="primary"
            icon={<IconDeck />}
            className="deck-summary__open"
            onClick={() => setWorkshopDeck('roadblock')}
          >
            Open Deck Workshop
          </Button>
        </>
      )}

      {workshopDeck && (
        <DeckWorkshop
          initialDeck={workshopDeck}
          roadblockCards={roadblockCards}
          curseCards={curseCards}
          isEditable={isEditable}
          onChangeRoadblocks={onChangeRoadblocks}
          onChangeCurses={onChangeCurses}
          onClose={() => setWorkshopDeck(null)}
        />
      )}
    </div>
  );
};
