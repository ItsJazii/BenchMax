"use client";

import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/clerk-react";

export function AuthControls({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <Link className="sign-in-link" href="/sign-in">
        Sign in
      </Link>
    );
  }

  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="sign-in-link" type="button">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link className="sign-in-link" href="/dashboard">
          Dashboard
        </Link>
        <UserButton />
      </SignedIn>
    </>
  );
}
