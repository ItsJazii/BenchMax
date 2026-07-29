"use client";

import { ClerkProvider } from "@clerk/clerk-react";

export function Providers({
  children,
  clerkPublishableKey,
}: {
  children: React.ReactNode;
  clerkPublishableKey: string | null;
}) {
  if (!clerkPublishableKey) return children;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      {children}
    </ClerkProvider>
  );
}
