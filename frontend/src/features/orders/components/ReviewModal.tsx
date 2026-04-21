/**
 * Modal that lets the customer rate a delivered order.
 *
 * - Star rating is required (1-5). Implemented with `react-hook-form` via the
 *   project's shadcn `Form` wrapper so validation messages stay consistent
 *   with the rest of the app.
 * - Optional free-text comment (max 500 chars).
 * - Submits via `useCreateReviewMutation`, which invalidates the order
 *   detail query so the page re-renders without the review button.
 */
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

import { useCreateReviewMutation } from '../api';

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface ReviewModalProps {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after a successful submission; parent can close the dialog. */
  onSubmitted?: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                Form shape                                  */
/* -------------------------------------------------------------------------- */
interface ReviewFormValues {
  rating: number;
  comment: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function ReviewModal({
  orderId,
  open,
  onOpenChange,
  onSubmitted,
}: ReviewModalProps): React.ReactElement {
  const mutation = useCreateReviewMutation();
  const form = useForm<ReviewFormValues>({
    defaultValues: { rating: 0, comment: '' },
    mode: 'onTouched',
  });

  const ratingValue = form.watch('rating');

  // Reset fields whenever the dialog is reopened fresh.
  useEffect(() => {
    if (open) {
      form.reset({ rating: 0, comment: '' });
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (values.rating < 1 || values.rating > 5) {
      form.setError('rating', { type: 'manual', message: 'Please pick a star rating.' });
      return;
    }
    mutation.mutate(
      {
        orderId,
        body: {
          rating: values.rating,
          comment: values.comment.trim() === '' ? null : values.comment.trim(),
        },
      },
      {
        onSuccess: () => {
          toast.success('Thanks for your review!');
          onOpenChange(false);
          onSubmitted?.();
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.detail : 'Could not submit review';
          toast.error(msg);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate your order</DialogTitle>
          <DialogDescription>
            Share your experience so others can make great choices.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="rating"
              rules={{ min: { value: 1, message: 'Please pick a star rating.' } }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your rating</FormLabel>
                  <FormControl>
                    <StarRatingInput
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="comment"
              rules={{ maxLength: { value: 500, message: 'Max 500 characters.' } }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comment (optional)</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={4}
                      maxLength={500}
                      placeholder="What did you love? Anything we can do better?"
                      className={cn(
                        'flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none',
                        'placeholder:text-muted-foreground',
                        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
                        'aria-invalid:border-destructive aria-invalid:ring-destructive/30',
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || ratingValue < 1}>
                {mutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Submitting
                  </>
                ) : (
                  'Submit review'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Star rating input                             */
/* -------------------------------------------------------------------------- */
/** Keyboard-accessible 1-5 star rating. Hover preview provides quick feedback. */
function StarRatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div
      role="radiogroup"
      aria-label="Star rating"
      className="inline-flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= active;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            key={star}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(0)}
            className={cn(
              'rounded-md p-1 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'hover:scale-110',
            )}
          >
            <Star
              className={cn(
                'size-7',
                filled ? 'fill-warning text-warning' : 'text-muted-foreground',
              )}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

export default ReviewModal;
