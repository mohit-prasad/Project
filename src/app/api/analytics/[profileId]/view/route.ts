import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db-schema";
import { trackProfileView } from "@/lib/analytics/tracker";

// Rate limiting for view tracking (prevent spam)
const viewTracker = new Map<string, { count: number; resetTime: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxViews = 10; // Max 10 views per minute per IP

  const current = viewTracker.get(ip);

  if (!current || now > current.resetTime) {
    viewTracker.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (current.count >= maxViews) {
    return true;
  }

  current.count++;
  return false;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  try {
    const { profileId } = params;
    const ip = request.ip || request.headers.get("x-forwarded-for") || "unknown";

    // Rate limiting
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Validate profileId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(profileId)) {
      return NextResponse.json(
        { error: "Invalid profile ID" },
        { status: 400 }
      );
    }

    // Check if profile exists and is public
    const profile = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);

    if (!profile.length) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    const profileData = profile[0];

    if (!profileData.isPublic) {
      return NextResponse.json(
        { error: "Profile is not public" },
        { status: 403 }
      );
    }

    // Increment view count in PostgreSQL
    const currentProfile = await db
      .select({ viewCount: profiles.viewCount })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);

    if (currentProfile.length > 0) {
      const newViewCount = (currentProfile[0].viewCount || 0) + 1;
      await db
        .update(profiles)
        .set({ viewCount: newViewCount })
        .where(eq(profiles.id, profileId));
    }

    // Track detailed analytics in MongoDB
    await trackProfileView(profileId, request);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Profile view tracking error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}