export type Category =
  | "Electronics"
  | "Home & Garden"
  | "Fashion"
  | "Vehicles"
  | "Sports & Outdoors"
  | "Other";

export const CATEGORIES: Category[] = [
  "Electronics",
  "Home & Garden",
  "Fashion",
  "Vehicles",
  "Sports & Outdoors",
  "Other",
];

export const CATEGORY_ICON: Record<Category, string> = {
  Electronics: "💻",
  "Home & Garden": "🛋️",
  Fashion: "👕",
  Vehicles: "🚗",
  "Sports & Outdoors": "🏀",
  Other: "📦",
};

export type Listing = {
  id: string;
  title: string;
  description: string;
  price: number;
  category: Category;
  location: string;
  seller: string;
  createdAt: string;
};

export const MOCK_LISTINGS: Listing[] = [
  {
    id: "1",
    title: "MacBook Pro 14\" M2",
    description:
      "Lightly used MacBook Pro, 16GB RAM, 512GB SSD. Comes with original charger and box.",
    price: 1350,
    category: "Electronics",
    location: "Austin, TX",
    seller: "jordan_k",
    createdAt: "2026-07-28",
  },
  {
    id: "2",
    title: "Mid-Century Modern Sofa",
    description:
      "3-seater sofa in great condition, walnut legs, olive green fabric. Pickup only.",
    price: 420,
    category: "Home & Garden",
    location: "Portland, OR",
    seller: "mavis.h",
    createdAt: "2026-07-30",
  },
  {
    id: "3",
    title: "Trek Marlin 7 Mountain Bike",
    description:
      "2023 model, ridden fewer than 10 times. Size medium, hydraulic disc brakes.",
    price: 680,
    category: "Sports & Outdoors",
    location: "Denver, CO",
    seller: "trailrider",
    createdAt: "2026-07-25",
  },
  {
    id: "4",
    title: "Leather Jacket - Men's L",
    description: "Genuine leather moto jacket, worn a handful of times, excellent condition.",
    price: 95,
    category: "Fashion",
    location: "Brooklyn, NY",
    seller: "citystyle",
    createdAt: "2026-08-01",
  },
  {
    id: "5",
    title: "2018 Honda Civic EX",
    description: "68k miles, one owner, clean title, recently serviced. Non-smoker.",
    price: 15200,
    category: "Vehicles",
    location: "Columbus, OH",
    seller: "d.reynolds",
    createdAt: "2026-07-20",
  },
  {
    id: "6",
    title: "Standing Desk (Electric)",
    description: "Dual motor sit-stand desk, 48x30 top, memory presets. Great home office setup.",
    price: 240,
    category: "Home & Garden",
    location: "Seattle, WA",
    seller: "wfh_setup",
    createdAt: "2026-08-02",
  },
];
