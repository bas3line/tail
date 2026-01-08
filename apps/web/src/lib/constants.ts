export const SITE = {
  TITLE: "Tails",
  TAGLINE: "Internet Swiss Army Knife",
  DESCRIPTION: "A powerful collection of developer tools in one place. Upload files, download videos, manage media, create pastes, and more — all with a simple API.",
  APP_URL: "/app",
  EMAIL: "hi@tail.tools",
  TWITTER_URL: "https://x.com/tailstools",
  GITHUB_URL: "https://github.com/tailstools",
  DISCORD_URL: "https://discord.gg/tails",
};

export const TOOLS = [
  {
    title: "Drive",
    description: "Upload and store any file with S3-backed storage and global CDN delivery. Resumable uploads, shareable links.",
    icon: "database",
    tags: ["100GB free", "No limits"],
    featured: true,
  },
  {
    title: "Video Downloader",
    description: "Download from YouTube, TikTok, Instagram, Twitter, Reddit, and 100+ platforms in any quality.",
    icon: "download",
    tags: ["100+ sites"],
  },
  {
    title: "Paste",
    description: "Share code snippets with syntax highlighting, password protection, and expiration dates.",
    icon: "code",
    tags: ["50+ languages"],
  },
  {
    title: "Images",
    description: "Resize, compress, convert formats. Automatic optimization for web delivery.",
    icon: "image",
    tags: ["WebP", "AVIF"],
  },
  {
    title: "Short Links",
    description: "Create short, memorable links with click tracking, analytics, and custom domains.",
    icon: "link",
    tags: ["Analytics"],
  },
  {
    title: "Screenshot API",
    description: "Capture any website programmatically. Full page, viewport, or element screenshots.",
    icon: "camera",
    tags: ["API"],
  },
  {
    title: "QR Codes",
    description: "Generate QR codes for URLs, text, WiFi, vCards, and more. Custom colors and logos.",
    icon: "qr",
    tags: ["Customizable"],
  },
  {
    title: "PDF Tools",
    description: "Merge, split, compress, convert PDFs. Extract text and images.",
    icon: "file",
    tags: ["Convert"],
  },
  {
    title: "JSON Tools",
    description: "Format, validate, transform JSON. Convert between JSON, YAML, CSV, and XML.",
    icon: "braces",
    tags: ["Transform"],
  },
  {
    title: "Hash Generator",
    description: "Generate MD5, SHA-1, SHA-256, SHA-512 hashes. Verify file integrity.",
    icon: "hash",
    tags: ["Security"],
  },
  {
    title: "Base64",
    description: "Encode and decode Base64 strings. Support for files and images.",
    icon: "binary",
    tags: ["Encode"],
  },
  {
    title: "UUID Generator",
    description: "Generate UUIDs v1, v4, v5. Bulk generation and validation.",
    icon: "fingerprint",
    tags: ["Bulk"],
  },
];

export const PRICING_PLANS = [
  {
    title: "Free",
    price: "$0",
    description: "Get started for free",
    features: [
      "1 GB storage",
      "100 API calls/day",
      "All tools access",
    ],
    button: {
      label: "Get started",
      href: "/signup",
    },
  },
  {
    title: "Starter",
    price: "$5",
    description: "For personal projects",
    features: [
      "10 GB storage",
      "1,000 API calls/day",
      "Priority support",
    ],
    button: {
      label: "Get started",
      href: "/signup?plan=starter",
    },
  },
  {
    title: "Pro",
    price: "$10",
    description: "For professionals",
    features: [
      "100 GB storage",
      "Unlimited API calls",
      "Custom domains",
    ],
    button: {
      label: "Get started",
      href: "/signup?plan=pro",
    },
    highlighted: true,
  },
  {
    title: "Team",
    price: "$20",
    description: "For teams",
    features: [
      "1 TB storage",
      "Everything in Pro",
      "Team collaboration",
    ],
    button: {
      label: "Get started",
      href: "/signup?plan=team",
    },
  },
];

export const FEATURES = [
  {
    title: "Simple API",
    description: "RESTful API with clear documentation. SDKs for JavaScript, Python, Go, and more.",
    icon: "api",
  },
  {
    title: "Global CDN",
    description: "Your files delivered from 200+ edge locations worldwide. Sub-50ms latency.",
    icon: "globe",
  },
  {
    title: "Secure",
    description: "Enterprise-grade security. Encryption at rest and in transit. SOC 2 compliant.",
    icon: "shield",
  },
  {
    title: "Webhooks",
    description: "Real-time notifications when events happen. Integrate with your workflow.",
    icon: "webhook",
  },
];

export const FAQS = [
  {
    question: "What is Tails?",
    answer: "Tails is an all-in-one developer toolkit that provides file storage, video downloading, URL shortening, image processing, and many more tools through a simple, unified API.",
  },
  {
    question: "Is there a free plan?",
    answer: "Yes! Our free plan includes 1GB of storage, 100 API calls per day, and access to all tools. No credit card required.",
  },
  {
    question: "How do I get started?",
    answer: "Simply sign up for a free account, grab your API key, and start making requests. Check out our documentation for code examples in multiple languages.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Absolutely. You can upgrade, downgrade, or cancel your subscription at any time. No long-term contracts or hidden fees.",
  },
  {
    question: "Do you offer custom enterprise plans?",
    answer: "Yes, we offer custom plans for larger teams with specific needs. Contact us at hi@tail.tools to discuss your requirements.",
  },
];

export const FOOTER_SECTIONS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Tools", href: "/home#tools" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "API Reference", href: "/docs/api" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: `mailto:${SITE.EMAIL}` },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
