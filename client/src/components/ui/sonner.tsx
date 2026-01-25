import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-center"
      toastOptions={{
        style: {
          zIndex: 99999,
        },
        classNames: {
          toast: "group toast group-[.toaster]:bg-slate-900 group-[.toaster]:text-white group-[.toaster]:border-slate-700 group-[.toaster]:shadow-lg",
          error: "group-[.toaster]:bg-red-900/90 group-[.toaster]:border-red-700 group-[.toaster]:text-red-100",
          success: "group-[.toaster]:bg-green-900/90 group-[.toaster]:border-green-700 group-[.toaster]:text-green-100",
          warning: "group-[.toaster]:bg-amber-900/90 group-[.toaster]:border-amber-700 group-[.toaster]:text-amber-100",
          info: "group-[.toaster]:bg-blue-900/90 group-[.toaster]:border-blue-700 group-[.toaster]:text-blue-100",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          zIndex: 99999,
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
