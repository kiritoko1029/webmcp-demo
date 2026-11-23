import 'react';

declare module 'react' {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooltitle?: string;
    tooldescription?: string;
    toolautosubmit?: string | boolean;
  }

  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }

  interface SelectHTMLAttributes<T> {
    toolparamdescription?: string;
  }

  interface TextareaHTMLAttributes<T> {
    toolparamdescription?: string;
  }

  interface FieldsetHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}
