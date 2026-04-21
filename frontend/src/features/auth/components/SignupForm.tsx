/**
 * New-account signup form.
 *
 * Validation mirrors the backend Pydantic `SignupIn`:
 *   - email: valid RFC address
 *   - full_name: min length 2, max 120
 *   - password: min 8, at least one uppercase + one digit
 *   - phone: optional
 */
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
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

import { useSignupMutation } from '../api';

const passwordPolicy = z
  .string()
  .min(8, { message: 'At least 8 characters' })
  .regex(/[A-Z]/, { message: 'Include at least one uppercase letter' })
  .regex(/[0-9]/, { message: 'Include at least one digit' });

const phonePolicy = z
  .string()
  .trim()
  .regex(/^[+0-9()\-\s]{7,20}$/, { message: 'Enter a valid phone number' })
  .optional()
  .or(z.literal(''));

const signupSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address' }),
  full_name: z
    .string()
    .trim()
    .min(2, { message: 'Name must be at least 2 characters' })
    .max(120, { message: 'Name is too long' }),
  password: passwordPolicy,
  phone: phonePolicy,
});

type SignupValues = z.infer<typeof signupSchema>;

export function SignupForm(): React.ReactElement {
  const navigate = useNavigate();
  const mutation = useSignupMutation();

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', full_name: '', password: '', phone: '' },
    mode: 'onTouched',
  });

  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({
        email: values.email,
        full_name: values.full_name,
        password: values.password,
        // Normalise empty string → undefined so backend treats it as null.
        ...(values.phone && values.phone.trim().length > 0
          ? { phone: values.phone.trim() }
          : {}),
      });
      toast.success('Account created — welcome to ZeroZero');
      void navigate('/', { replace: true });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : 'Could not create your account. Try again.';
      toast.error(detail);
    }
  });

  const isSubmitting = mutation.isPending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="name"
                  placeholder="Priya Sharma"
                  {...field}
                  ref={(el) => {
                    field.ref(el);
                    firstRef.current = el;
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Phone <span className="text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  {...field}
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
                  autoComplete="new-password"
                  placeholder="At least 8 chars, 1 uppercase, 1 digit"
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
              Creating account…
            </>
          ) : (
            'Create account'
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}

export default SignupForm;
