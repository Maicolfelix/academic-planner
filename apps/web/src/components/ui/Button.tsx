import type { ComponentProps } from 'react';
import { buttonStyles, type ButtonSize, type ButtonVariant } from './buttonStyles';

interface Props extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A native `<button>`. Unlike the browser default it is `type="button"` unless a form submit is asked for. */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: Props) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...rest} />;
}
