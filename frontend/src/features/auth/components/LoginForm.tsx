/**
 * Email + password login form.
 *
 * - react-hook-form + zod for field validation
 * - shadcn `Form*` primitives for label/control/error wiring + aria-invalid
 * - Shows the ApiError `detail` string as a sonner toast (server errors)
 * - On success navigates to the `from` location stashed by `ProtectedRoute`,
 *   falling back to `/`.
 */
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';

import { useLoginMutation } from '../api';

const loginSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LocationState {
  from?: { pathname?: string };
}

export function LoginForm(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const mutation = useLoginMutation();

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  // Autofocus email on mount for faster sign-in.
  const emailRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
      const fromPath = (location.state as LocationState | null)?.from?.pathname;
      void navigate(fromPath ?? '/', { replace: true });
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not sign in. Try again.';
      toast.error(detail);
      // Move focus to the password field so the user can correct quickly.
      form.setFocus('password');
    }
  });

  const isSubmitting = mutation.isPending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                  ref={(el) => {
                    field.ref(el);
                    emailRef.current = el;
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New to ZeroZero?{' '}
          <Link
            to="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </form>
    </Form>
  );
}

export default LoginForm;
