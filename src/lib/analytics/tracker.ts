import { MongoClient } from "mongodb";
import { AnalyticsEvent } from "@/lib/mongodb-schemas";

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

/**
 * Track analytics events and store them in MongoDB
 */
export async function trackAnalyticsEvent(event: CreateAnalyticsEventData) {
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

/**
 * Track profile view events
 */
export async function trackProfileView(
  profileId: string,
  request: Request,
  userId?: string
) {
  const userAgent = request.headers.get("user-agent") || undefined;
  const referrer = request.headers.get("referer") || undefined;

  // Get IP address from various headers
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";

  // Create a simple IP hash (in production, use proper hashing with salt)
  const ipHash = ip !== "unknown" ?
    Buffer.from(ip).toString("base64").substring(0, 16) :
    undefined;

  // Parse user agent to get device info (basic implementation)
  const deviceInfo = parseUserAgent(userAgent || "");

  await trackAnalyticsEvent({
    profileId,
    eventType: "view",
    data: {
      userAgent,
      ipHash,
      referrer,
      timestamp: new Date(),
      userId,
      ...deviceInfo,
    },
  });
}

/**
 * Parse user agent string to extract device information
 */
function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();

  // Detect device type
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
    deviceType = "mobile";
  } else if (ua.includes("tablet") || ua.includes("ipad")) {
    deviceType = "tablet";
  }

  // Detect browser (basic implementation)
  let browser = "unknown";
  if (ua.includes("chrome")) browser = "chrome";
  else if (ua.includes("firefox")) browser = "firefox";
  else if (ua.includes("safari")) browser = "safari";
  else if (ua.includes("edge")) browser = "edge";

  // Detect OS (basic implementation)
  let os = "unknown";
  if (ua.includes("windows")) os = "windows";
  else if (ua.includes("mac")) os = "macos";
  else if (ua.includes("linux")) os = "linux";
  else if (ua.includes("android")) os = "android";
  else if (ua.includes("ios") || ua.includes("iphone") || ua.includes("ipad")) os = "ios";

  return {
    deviceType,
    browser,
    os,
  };
}

/**
 * Get analytics data for a profile
 */
export async function getProfileAnalytics(
  profileId: string,
  dateRange: { start: Date; end: Date }
) {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new Error("MongoDB URL not configured");
    }

    const client = new MongoClient(mongoUrl);
    await client.connect();

    const db = client.db();
    const collection = db.collection<AnalyticsEvent>("analytics_events");

    const events = await collection
      .find({
        profileId,
        createdAt: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    await client.close();

    // Process events to generate analytics
    const views = events.filter(e => e.eventType === "view");
    const clicks = events.filter(e => e.eventType === "click");

    // Group by date for timeline data
    const timelineData = events.reduce((acc, event) => {
      const date = event.createdAt.toISOString().split("T")[0];
      const existing = acc.find(item => item.date === date);

      if (existing) {
        if (event.eventType === "view") existing.views++;
        if (event.eventType === "click") existing.clicks++;
      } else {
        acc.push({
          date,
          views: event.eventType === "view" ? 1 : 0,
          clicks: event.eventType === "click" ? 1 : 0,
        });
      }

      return acc;
    }, [] as { date: string; views: number; clicks: number }[]);

    // Device breakdown
    const deviceBreakdown = views.reduce((acc, view) => {
      const device = view.data.deviceType || "unknown";
      acc[device] = (acc[device] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Browser breakdown
    const browserBreakdown = views.reduce((acc, view) => {
      const browser = view.data.browser || "unknown";
      acc[browser] = (acc[browser] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // OS breakdown
    const osBreakdown = views.reduce((acc, view) => {
      const os = view.data.os || "unknown";
      acc[os] = (acc[os] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Link performance (for clicks)
    const linkPerformance = clicks.reduce((acc, click) => {
      if (click.data.linkId) {
        acc[click.data.linkId] = (acc[click.data.linkId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      overview: {
        totalViews: views.length,
        totalClicks: clicks.length,
        uniqueVisitors: new Set(views.map(v => v.data.ipHash)).size,
        clickThroughRate: views.length > 0 ? (clicks.length / views.length) * 100 : 0,
      },
      timeline: timelineData.reverse(),
      breakdowns: {
        devices: deviceBreakdown,
        browsers: browserBreakdown,
        os: osBreakdown,
      },
      linkPerformance,
    };

  } catch (error) {
    console.error("Failed to get profile analytics:", error);
    throw error;
  }
}