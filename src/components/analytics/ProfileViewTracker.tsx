"use client";

import { useEffect } from "react";

interface ProfileViewTrackerProps {
  profileId: string;
}

export function ProfileViewTracker({ profileId }: ProfileViewTrackerProps) {
  useEffect(() => {
    // Track profile view when component mounts
    const trackView = async () => {
      try {
        await fetch(`/api/analytics/${profileId}/view`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        console.error("Failed to track profile view:", error);
      }
    };

    trackView();
  }, [profileId]);

  // This component doesn't render anything
  return null;
}