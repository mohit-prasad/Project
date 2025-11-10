import { notFound } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, users, profileLinks, socialAccounts } from "@/lib/db-schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProfileViewTracker } from "@/components/analytics/ProfileViewTracker";
import {
  Github,
  Twitter,
  Instagram,
  Linkedin,
  Youtube,
  Twitch,
  MessageCircle,
  ExternalLink,
  User
} from "lucide-react";

interface ProfilePageProps {
  params: {
    slug: string;
  };
}

const socialIcons = {
  github: Github,
  twitter: Twitter,
  instagram: Instagram,
  linkedin: Linkedin,
  youtube: Youtube,
  twitch: Twitch,
  discord: MessageCircle,
};

const linkIcons = {
  link: ExternalLink,
  website: ExternalLink,
  portfolio: ExternalLink,
  blog: ExternalLink,
  store: ExternalLink,
  video: ExternalLink,
  music: ExternalLink,
  photo: ExternalLink,
  custom: ExternalLink,
};

async function getProfileData(slug: string) {
  const profile = await db
    .select({
      profile: profiles,
      user: users,
      links: profileLinks,
      socialAccounts: socialAccounts,
    })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .leftJoin(
      profileLinks,
      and(
        eq(profileLinks.profileId, profiles.id),
        eq(profileLinks.isActive, true)
      )
    )
    .leftJoin(
      socialAccounts,
      and(
        eq(socialAccounts.profileId, profiles.id),
        eq(socialAccounts.isVerified, true)
      )
    )
    .where(eq(profiles.slug, slug))
    .orderBy(profileLinks.displayOrder);

  if (!profile.length) {
    return null;
  }

  // Group and organize the data
  const profileData = {
    profile: profile[0].profile,
    user: profile[0].user,
    links: profile
      .filter((row) => row.links)
      .map((row) => row.links!)
      .sort((a, b) => a.displayOrder - b.displayOrder),
    socialAccounts: profile
      .filter((row) => row.socialAccounts)
      .map((row) => row.socialAccounts!)
      .sort((a, b) => a.displayOrder - b.displayOrder),
  };

  return profileData;
}

async function incrementProfileView(profileId: string) {
  try {
    // Get current view count
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
  } catch (error) {
    console.error("Failed to increment profile view:", error);
  }
}

function getThemeStyles(theme: string, backgroundType: string, backgroundValue: string) {
  const themes = {
    default: {
      background: "bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-blue-950",
      text: "text-gray-900 dark:text-white",
      cardBg: "bg-white/80 dark:bg-gray-800/80",
      linkBg: "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700",
      borderColor: "border-gray-200 dark:border-gray-700",
    },
    dark: {
      background: "bg-gradient-to-br from-gray-900 to-black",
      text: "text-white",
      cardBg: "bg-gray-800/80",
      linkBg: "bg-gray-800 hover:bg-gray-700",
      borderColor: "border-gray-700",
    },
    minimal: {
      background: "bg-white dark:bg-black",
      text: "text-gray-900 dark:text-white",
      cardBg: "bg-white/60 dark:bg-black/60",
      linkBg: "bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800",
      borderColor: "border-gray-200 dark:border-gray-800",
    },
  };

  const selectedTheme = themes[theme as keyof typeof themes] || themes.default;

  // Override background if custom value is provided
  if (backgroundType === "color" && backgroundValue) {
    selectedTheme.background = "";
    return {
      ...selectedTheme,
      background: "",
      customBackground: `background-color: ${backgroundValue}`,
    };
  }

  if (backgroundType === "gradient" && backgroundValue) {
    selectedTheme.background = "";
    return {
      ...selectedTheme,
      background: "",
      customBackground: `background: ${backgroundValue}`,
    };
  }

  return selectedTheme;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const profileData = await getProfileData(params.slug);

  if (!profileData) {
    notFound();
  }

  const { profile, user, links, socialAccounts } = profileData;

  // Increment view count asynchronously
  incrementProfileView(profile.id);

  const themeStyles = getThemeStyles(profile.theme, profile.backgroundType, profile.backgroundValue || "");

  return (
    <div
      className={`min-h-screen ${themeStyles.background} ${themeStyles.text}`}
      style={themeStyles.customBackground ? {
        background: themeStyles.customBackground.includes('background:')
          ? themeStyles.customBackground
          : themeStyles.customBackground
      } : undefined}
    >
      {/* Analytics tracker - invisible component that tracks profile views */}
      <ProfileViewTracker profileId={profile.id} />

      <div className="container mx-auto px-4 py-12 max-w-2xl">
        {/* Header Section */}
        <Card className={`${themeStyles.cardBg} backdrop-blur-sm border ${themeStyles.borderColor} mb-8`}>
          <CardContent className="p-8 text-center">
            {/* Avatar */}
            <div className="mb-6">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName || user.username}
                  className="w-24 h-24 rounded-full mx-auto border-4 border-white dark:border-gray-700 shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 rounded-full mx-auto bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <User className="w-12 h-12 text-gray-500 dark:text-gray-400" />
                </div>
              )}
            </div>

            {/* Name and Bio */}
            <h1 className="text-3xl font-bold mb-2">
              {profile.title || user.displayName || user.username}
            </h1>

            {profile.description && (
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-6 max-w-md mx-auto">
                {profile.description}
              </p>
            )}

            {/* Social Accounts */}
            {socialAccounts.length > 0 && (
              <div className="flex justify-center gap-4 mb-6">
                {socialAccounts.map((social) => {
                  const IconComponent = socialIcons[social.platform as keyof typeof socialIcons] || ExternalLink;
                  return (
                    <a
                      key={social.id}
                      href={`https://${social.platform}.com/${social.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-3 rounded-full ${themeStyles.linkBg} ${themeStyles.borderColor} border transition-transform hover:scale-110`}
                      title={social.displayName || `${social.platform} - ${social.username}`}
                    >
                      <IconComponent className="w-5 h-5" />
                    </a>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Links Section */}
        <div className="space-y-4">
          {links.length === 0 ? (
            <Card className={`${themeStyles.cardBg} backdrop-blur-sm border ${themeStyles.borderColor}`}>
              <CardContent className="p-8 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                  No links added yet
                </p>
              </CardContent>
            </Card>
          ) : (
            links.map((link) => {
              const IconComponent = linkIcons[link.icon as keyof typeof linkIcons] || ExternalLink;
              return (
                <a
                  key={link.id}
                  href={`/api/links/${link.id}/click`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Card className={`${themeStyles.linkBg} ${themeStyles.borderColor} border transition-all hover:shadow-lg hover:scale-[1.02] cursor-pointer`}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${themeStyles.cardBg} ${themeStyles.borderColor} border`}>
                          <IconComponent className="w-5 h-5" />
                        </div>
                        <span className="font-medium">{link.title}</span>
                      </div>
                      <ExternalLink className="w-4 h-4 opacity-60" />
                    </CardContent>
                  </Card>
                </a>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-sm text-gray-500 dark:text-gray-400">
          <p>
            Create your free bio link page at{" "}
            <a href="/" className="underline hover:text-gray-700 dark:hover:text-gray-300">
              BioLink
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: ProfilePageProps) {
  const profileData = await getProfileData(params.slug);

  if (!profileData) {
    return {
      title: "Profile Not Found",
      description: "This profile could not be found.",
    };
  }

  const { profile, user } = profileData;
  const title = profile.title || user.displayName || user.username;
  const description = profile.description || `Check out ${title}'s bio link page`;

  return {
    title: `${title} | BioLink`,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://biolink.app/u/${params.slug}`,
      images: user.avatarUrl ? [user.avatarUrl] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: user.avatarUrl ? [user.avatarUrl] : [],
    },
  };
}