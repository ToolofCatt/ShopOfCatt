'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalid?: boolean;
}

/** Ô nhập mật khẩu kèm nút hiện/ẩn. */
export function PasswordInput({ invalid, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...rest}
        invalid={invalid}
        type={visible ? 'text' : 'password'}
        className="pr-10"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        className="absolute right-0 top-0 flex h-10 w-10 cursor-pointer items-center justify-center text-neutral-400 transition-colors hover:text-neutral-950"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
