"use client";

import { useCallback, useEffect, useState } from "react";
import { Listing, MOCK_LISTINGS } from "./listings";

const STORAGE_KEY = "martket.user-listings";

function readUserListings(): Listing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Listing[]) : [];
  } catch {
    return [];
  }
}

export function useListings() {
  const [userListings, setUserListings] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Deferred to an effect (rather than lazy initial state) so the client's
    // first render matches the server-rendered markup before localStorage is read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserListings(readUserListings());
    setLoaded(true);
  }, []);

  const addListing = useCallback((listing: Listing) => {
    setUserListings((prev) => {
      const next = [listing, ...prev];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const listings = [...userListings, ...MOCK_LISTINGS];

  return { listings, addListing, loaded };
}
