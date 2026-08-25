import React, { useState } from 'react';
import { Dialog, Input, Textarea, Button, Notice } from '@ds';

export interface CreateItemDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; description: string }) => Promise<void>;
}

export const CreateItemDialog: React.FC<CreateItemDialogProps> = ({
  open,
  onClose,
  onSubmit
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit roadmap item');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} title="Submit Roadmap Idea" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <Notice kind="stop">{error}</Notice>}

        <Input
          label="Title *"
          placeholder="e.g., Custom Waypoint Audio Effects"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Textarea
          label="Description"
          placeholder="Describe your idea or feature request in detail..."
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !title.trim()}>
            {submitting ? 'Submitting...' : 'Submit Idea'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
