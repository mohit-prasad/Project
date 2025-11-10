import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileLinks, profiles } from "@/lib/db-schema";
import { MongoClient } from "mongodb";
import { AnalyticsEvent } from "@/lib/mongodb-schemas";

// Rate limiting in memory (for production, use Redis)
const clickTracker = new Map<string, { count: number; resetTime: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxClicks = 30; // Max 30 clicks per minute per IP

  const current = clickTracker.get(ip);

  if (!current || now > current.resetTime) {
    clickTracker.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (current.count >= maxClicks) {
    return true;
  }

  current.count++;
  return false;
}

function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Only allow http and https protocols
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
    return urlObj.toString();
  } catch {
    throw new Error("Invalid URL format");
  }
}

async function trackAnalyticsEvent(event: CreateAnalyticsEventData) {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      console.error("MongoDB URL not configured");
      return;
    }

    const client = new MongoClient(mongoUrl);
    await client.connect();

    const db = client.db();
    const collection = db.collection<AnalyticsEvent>("analytics_events");

    await collection.insertOne({
      ...event,
      _id: undefined,
      createdAt: new Date(),
    } as any);

    await client.close();
  } catch (error) {
    console.error("Failed to track analytics event:", error);
  }
}

interface CreateAnalyticsEventData {
  profileId: string;
  eventType: "view" | "click" | "template_download";
  data: {
    linkId?: string;
    userAgent?: string;
    ipHash?: string;
    referrer?: string;
    country?: string;
    timestamp: Date;
    userId?: string;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { linkId: string } }
) {
  try {
    const { linkId } = params;
    const ip = request.ip || request.headers.get("x-forwarded-for") || "unknown";

    // Rate limiting
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Validate linkId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(linkId)) {
      return NextResponse.json(
        { error: "Invalid link ID" },
        { status: 400 }
      );
    }

    // Get the link and verify it belongs to an active profile
    const linkResult = await db
      .select({
        link: profileLinks,
        profile: profiles,
      })
      .from(profileLinks)
      .innerJoin(profiles, eq(profileLinks.profileId, profiles.id))
      .where(
        and(
          eq(profileLinks.id, linkId),
          eq(profileLinks.isActive, true),
          eq(profiles.isPublic, true)
        )
      )
      .limit(1);

    if (!linkResult.length) {
      return NextResponse.json(
        { error: "Link not found or inactive" },
        { status: 404 }
      );
    }

    const { link, profile } = linkResult[0];

    // Sanitize and validate URL
    const sanitizedUrl = sanitizeUrl(link.url);

    // Increment click count in PostgreSQL
    const currentLink = await db
      .select({ clickCount: profileLinks.clickCount })
      .from(profileLinks)
      .where(eq(profileLinks.id, linkId))
      .limit(1);

    if (currentLink.length > 0) {
      const newClickCount = (currentLink[0].clickCount || 0) + 1;
      await db
        .update(profileLinks)
        .set({ clickCount: newClickCount })
        .where(eq(profileLinks.id, linkId));
    }

    // Also increment profile's total click count
    const currentProfile = await db
      .select({ clickCount: profiles.clickCount })
      .from(profiles)
      .where(eq(profiles.id, profile.id))
      .limit(1);

    if (currentProfile.length > 0) {
      const newProfileClickCount = (currentProfile[0].clickCount || 0) + 1;
      await db
        .update(profiles)
        .set({ clickCount: newProfileClickCount })
        .where(eq(profiles.id, profile.id));
    }

    // Track analytics event in MongoDB
    const userAgent = request.headers.get("user-agent") || undefined;
    const referrer = request.headers.get("referer") || undefined;

    // Create a simple IP hash (in production, use proper hashing)
    const ipHash = ip !== "unknown" ?
      Buffer.from(ip).toString("base64").substring(0, 16) :
      undefined;

    await trackAnalyticsEvent({
      profileId: profile.id,
      eventType: "click",
      data: {
        linkId: link.id,
        userAgent,
        ipHash,
        referrer,
        timestamp: new Date(),
      },
    });

    // Redirect to the target URL
    return NextResponse.redirect(sanitizedUrl, 302);

  } catch (error) {
    console.error("Link click tracking error:", error);

    if (error instanceof Error && error.message === "Invalid URL format") {
      return NextResponse.json(
        { error: "Invalid link URL" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}