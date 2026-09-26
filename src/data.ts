export interface User {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  rentals: number;
  responseRate: number;
  verified: boolean;
  joinedYear: number;
  bio: string;
  onTimeReturns: number;
  unresolvedClaims: number;
}

export interface Component {
  name: string;
  present: boolean;
}

export interface Review {
  id: string;
  author: string;
  avatar: string;
  rating: number;
  date: string;
  text: string;
}

export interface Listing {
  id: string;
  title: string;
  category: string;
  images: string[];
  pricePerDay: number;
  distance: number;
  distanceUnit: string;
  owner: User;
  rating: number;
  reviewCount: number;
  rentalCount: number;
  available: boolean;
  instantBooking: boolean;
  verifiedOwner: boolean;
  protectionEligible: boolean;
  deliveryAvailable: boolean;
  condition: string;
  description: string;
  whatsIncluded: string[];
  components: Component[];
  declaredValue: number;
  assetId: string;
  serialPartial: string;
  ownershipVerified: boolean;
  rentalHistory: number;
  damageHistory: string;
  pickup: string;
  delivery: string;
  cancellation: string;
  reviews: Review[];
  deposit: number;
  lat: number;
  lng: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  image: string;
  count: number;
}

export interface Booking {
  id: string;
  listing: Listing;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'active' | 'past' | 'pending' | 'cancelled';
  total: number;
  pickupTime: string;
  isOwner: boolean;
}

export interface Claim {
  id: string;
  listingTitle: string;
  issue: string;
  amount: number;
  status: 'under-review' | 'resolved' | 'critical';
  date: string;
  timeline: { step: string; done: boolean; current?: boolean }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

export interface RentalRequest {
  id: string;
  listingTitle: string;
  renterName: string;
  renterAvatar: string;
  renterRating: number;
  renterRentals: number;
  renterVerified: boolean;
  renterClaims: number;
  startDate: string;
  endDate: string;
  total: number;
  status: 'pending' | 'accepted' | 'declined';
}

export interface NeedRequest {
  id: string;
  title: string;
  when: string;
  location: string;
  budget: number;
  renter: string;
  avatar: string;
  postedAgo: string;
  offers: number;
}

export interface Message {
  id: string;
  sender: 'me' | 'them' | 'system';
  text: string;
  time: string;
}

export interface Conversation {
  id: string;
  name: string;
  avatar: string;
  listingTitle: string;
  listingImage: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  messages: Message[];
}

const users: User[] = [
  {
    id: 'u1',
    name: 'Alex Rivera',
    avatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.9,
    rentals: 52,
    responseRate: 98,
    verified: true,
    joinedYear: 2024,
    bio: 'Photographer and gear enthusiast. Happy to share my kit with fellow creators.',
    onTimeReturns: 51,
    unresolvedClaims: 0,
  },
  {
    id: 'u2',
    name: 'Sarah Chen',
    avatar: 'https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 5.0,
    rentals: 34,
    responseRate: 100,
    verified: true,
    joinedYear: 2023,
    bio: 'Event planner with a garage full of party supplies. Fast responses, flexible pickup.',
    onTimeReturns: 34,
    unresolvedClaims: 0,
  },
  {
    id: 'u3',
    name: 'Marcus Johnson',
    avatar: 'https://images.pexels.com/photos/6975099/pexels-photo-6975099.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.8,
    rentals: 89,
    responseRate: 95,
    verified: true,
    joinedYear: 2022,
    bio: 'Contractor by day. My tools work hard so your projects can too.',
    onTimeReturns: 86,
    unresolvedClaims: 1,
  },
  {
    id: 'u4',
    name: 'Priya Patel',
    avatar: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.9,
    rentals: 41,
    responseRate: 97,
    verified: true,
    joinedYear: 2024,
    bio: 'Outdoor adventurer. Camping gear ready for your next trip.',
    onTimeReturns: 40,
    unresolvedClaims: 0,
  },
  {
    id: 'u5',
    name: 'David Kim',
    avatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.7,
    rentals: 67,
    responseRate: 92,
    verified: true,
    joinedYear: 2023,
    bio: 'Music producer and DJ. Studio-grade gear available for your next gig.',
    onTimeReturns: 64,
    unresolvedClaims: 0,
  },
  {
    id: 'u6',
    name: 'Emma Wilson',
    avatar: 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 5.0,
    rentals: 28,
    responseRate: 100,
    verified: true,
    joinedYear: 2025,
    bio: 'Mom of two. Baby gear that my kids have outgrown - clean, safe, and ready to go.',
    onTimeReturns: 28,
    unresolvedClaims: 0,
  },
  {
    id: 'u7',
    name: 'James Foster',
    avatar: 'https://images.pexels.com/photos/91227/pexels-photo-91227.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.8,
    rentals: 73,
    responseRate: 94,
    verified: true,
    joinedYear: 2022,
    bio: 'Lawn care pro. Commercial-grade equipment at a fraction of the cost.',
    onTimeReturns: 71,
    unresolvedClaims: 0,
  },
  {
    id: 'u8',
    name: 'Lily Zhang',
    avatar: 'https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    rating: 4.9,
    rentals: 45,
    responseRate: 99,
    verified: true,
    joinedYear: 2024,
    bio: 'Tech enthusiast. Latest gadgets and electronics, well maintained.',
    onTimeReturns: 44,
    unresolvedClaims: 0,
  },
];

function makeReviews(seed: string, count: number): Review[] {
  const reviewTexts = [
    'Pickup was smooth and the item was in perfect condition. Would rent again!',
    'Great owner, very responsive and flexible with timing. Highly recommend.',
    'Exactly as described. Everything worked flawlessly for my entire rental.',
    'Clean, well-maintained, and easy to return. The whole process was painless.',
    'Owner was friendly and the item passport gave me real peace of mind.',
    'A bit late on pickup but the owner communicated well. Great gear overall.',
    'Rental protection made me feel safe booking with a stranger. Worth it.',
    'Better than buying. The condition was excellent and all components were included.',
  ];
  const authors = ['Mike T.', 'Jessica L.', 'Tom B.', 'Nina K.', 'Carlos M.', 'Beth R.', 'Ahmed S.', 'Jenny P.'];
  const avatars = [
    'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
  ];
  const reviews: Review[] = [];
  for (let i = 0; i < Math.min(count, 6); i++) {
    reviews.push({
      id: `${seed}-r${i}`,
      author: authors[i % authors.length],
      avatar: avatars[i % avatars.length],
      rating: i % 5 === 4 ? 4 : 5,
      date: ['2 days ago', '1 week ago', '3 weeks ago', '1 month ago', '2 months ago', '3 months ago'][i] ?? '4 months ago',
      text: reviewTexts[i % reviewTexts.length],
    });
  }
  return reviews;
}

export const categories: Category[] = [
  { id: 'cameras', name: 'Cameras', icon: 'Camera', image: 'https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 1240 },
  { id: 'tools', name: 'Tools', icon: 'Wrench', image: 'https://images.pexels.com/photos/30413428/pexels-photo-30413428.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 2180 },
  { id: 'electronics', name: 'Electronics', icon: 'Monitor', image: 'https://images.pexels.com/photos/5515482/pexels-photo-5515482.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 980 },
  { id: 'camping', name: 'Camping', icon: 'Tent', image: 'https://images.pexels.com/photos/2526025/pexels-photo-2526025.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 760 },
  { id: 'party', name: 'Party', icon: 'PartyPopper', image: 'https://images.pexels.com/photos/35985211/pexels-photo-35985211.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 1450 },
  { id: 'sports', name: 'Sports', icon: 'Dumbbell', image: 'https://images.pexels.com/photos/36450314/pexels-photo-36450314.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 620 },
  { id: 'garden', name: 'Garden', icon: 'Trees', image: 'https://images.pexels.com/photos/37554739/pexels-photo-37554739.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 540 },
  { id: 'baby', name: 'Baby', icon: 'Baby', image: 'https://images.pexels.com/photos/5997705/pexels-photo-5997705.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 380 },
  { id: 'music', name: 'Music', icon: 'Music', image: 'https://images.pexels.com/photos/35486274/pexels-photo-35486274.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 470 },
  { id: 'home', name: 'Home', icon: 'Home', image: 'https://images.pexels.com/photos/6996340/pexels-photo-6996340.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop', count: 830 },
];

const cameraComponents: Component[] = [
  { name: 'Camera body', present: true },
  { name: '24–70mm lens', present: true },
  { name: 'Battery #1', present: true },
  { name: 'Battery #2', present: true },
  { name: 'Charger', present: true },
  { name: 'USB cable', present: true },
  { name: 'Strap', present: true },
  { name: 'Carrying case', present: true },
];

export const listings: Listing[] = [
  {
    id: 'l1',
    title: 'Sony A7 IV Mirrorless Camera',
    category: 'Cameras',
    images: [
      'https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/19969445/pexels-photo-19969445.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/19969447/pexels-photo-19969447.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/14396385/pexels-photo-14396385.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 85,
    distance: 0.8,
    distanceUnit: 'mi',
    owner: users[0],
    rating: 4.9,
    reviewCount: 128,
    rentalCount: 42,
    available: true,
    instantBooking: false,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'Full-frame 33MP mirrorless camera with 4K60p video. Includes versatile 24–70mm f/2.8 lens. Perfect for professional photo and video work. Well-maintained with low shutter count.',
    whatsIncluded: ['Camera body', '24–70mm f/2.8 lens', 'Battery ×2', 'Charger', 'Strap', 'Carrying case'],
    components: cameraComponents,
    declaredValue: 2500,
    assetId: 'CAM-28491',
    serialPartial: 'SN••••8921',
    ownershipVerified: true,
    rentalHistory: 42,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 10 miles for $15',
    cancellation: 'Free cancellation up to 48 hours before pickup',
    reviews: makeReviews('l1', 128),
    deposit: 500,
    lat: 32.814,
    lng: -96.949,
  },
  {
    id: 'l2',
    title: 'DeWalt 20V Cordless Drill Kit',
    category: 'Tools',
    images: [
      'https://images.pexels.com/photos/30413428/pexels-photo-30413428.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/30413424/pexels-photo-30413424.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/6790821/pexels-photo-6790821.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 25,
    distance: 1.4,
    distanceUnit: 'mi',
    owner: users[2],
    rating: 4.8,
    reviewCount: 89,
    rentalCount: 67,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: false,
    condition: 'Very Good',
    description: 'Professional-grade cordless drill with two 20V batteries, charger, and a full set of bits. Handles everything from framing to cabinetry.',
    whatsIncluded: ['Drill', 'Battery ×2', 'Charger', 'Bit set (32 pc)', 'Carrying bag'],
    components: [
      { name: 'Drill', present: true },
      { name: 'Battery #1', present: true },
      { name: 'Battery #2', present: true },
      { name: 'Charger', present: true },
      { name: 'Bit set', present: true },
      { name: 'Carrying bag', present: true },
    ],
    declaredValue: 350,
    assetId: 'TLS-19284',
    serialPartial: 'SN••••4471',
    ownershipVerified: true,
    rentalHistory: 67,
    damageHistory: 'Minor cosmetic wear',
    pickup: 'Dallas, TX - approximate location shown until booking',
    delivery: 'Pickup only',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l2', 89),
    deposit: 100,
    lat: 32.78,
    lng: -96.8,
  },
  {
    id: 'l3',
    title: '4K Ultra Short Throw Projector',
    category: 'Electronics',
    images: [
      'https://images.pexels.com/photos/5515482/pexels-photo-5515482.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/6552592/pexels-photo-6552592.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/7886852/pexels-photo-7886852.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 60,
    distance: 2.3,
    distanceUnit: 'mi',
    owner: users[7],
    rating: 4.9,
    reviewCount: 56,
    rentalCount: 31,
    available: true,
    instantBooking: false,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'Ultra short throw 4K laser projector. 3,000 lumens - perfect for backyard movie nights or presentations. Includes 100" screen.',
    whatsIncluded: ['Projector', '100" screen', 'Power cable', 'HDMI cable', 'Remote', 'Carrying case'],
    components: [
      { name: 'Projector', present: true },
      { name: '100" screen', present: true },
      { name: 'Power cable', present: true },
      { name: 'HDMI cable', present: true },
      { name: 'Remote', present: true },
      { name: 'Carrying case', present: true },
    ],
    declaredValue: 1800,
    assetId: 'ELC-33821',
    serialPartial: 'SN••••7741',
    ownershipVerified: true,
    rentalHistory: 31,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 15 miles for $20',
    cancellation: 'Free cancellation up to 48 hours before pickup',
    reviews: makeReviews('l3', 56),
    deposit: 400,
    lat: 32.81,
    lng: -96.94,
  },
  {
    id: 'l4',
    title: '4-Person Camping Tent + Sleeping Bags',
    category: 'Camping',
    images: [
      'https://images.pexels.com/photos/2526025/pexels-photo-2526025.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/30041430/pexels-photo-30041430.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/10513799/pexels-photo-10513799.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 35,
    distance: 3.1,
    distanceUnit: 'mi',
    owner: users[3],
    rating: 4.9,
    reviewCount: 42,
    rentalCount: 28,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Good',
    description: 'Waterproof 4-person dome tent with rain fly. Includes 4 sleeping bags (rated to 40°F) and sleeping pads. Great for weekend camping trips.',
    whatsIncluded: ['4-person tent', 'Rain fly', 'Sleeping bag ×4', 'Sleeping pad ×4', 'Stakes', 'Stuff sack'],
    components: [
      { name: 'Tent body', present: true },
      { name: 'Rain fly', present: true },
      { name: 'Sleeping bag #1', present: true },
      { name: 'Sleeping bag #2', present: true },
      { name: 'Sleeping bag #3', present: true },
      { name: 'Sleeping bag #4', present: true },
      { name: 'Stakes', present: true },
      { name: 'Stuff sack', present: true },
    ],
    declaredValue: 450,
    assetId: 'CMP-44120',
    serialPartial: 'SN••••1120',
    ownershipVerified: true,
    rentalHistory: 28,
    damageHistory: 'Minor scuff on stuff sack',
    pickup: 'Las Colinas, TX - approximate location shown until booking',
    delivery: 'Delivery available within 20 miles for $15',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l4', 42),
    deposit: 150,
    lat: 32.88,
    lng: -96.95,
  },
  {
    id: 'l5',
    title: 'Round Banquet Tables (10) + Chairs (80)',
    category: 'Party',
    images: [
      'https://images.pexels.com/photos/35985211/pexels-photo-35985211.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/50675/banquet-wedding-society-deco-50675.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/9644360/pexels-photo-9644360.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 120,
    distance: 4.2,
    distanceUnit: 'mi',
    owner: users[1],
    rating: 5.0,
    reviewCount: 67,
    rentalCount: 34,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Very Good',
    description: 'Complete party setup: 10 round 60" banquet tables and 80 padded chairs. Perfect for weddings, corporate events, and celebrations. Delivery and setup available.',
    whatsIncluded: ['10 × 60" round tables', '80 × padded chairs', 'Table linens (white)', 'Delivery and setup option'],
    components: [
      { name: 'Table #1–10', present: true },
      { name: 'Chairs #1–80', present: true },
      { name: 'Linens', present: true },
      { name: 'Tiebacks', present: true },
    ],
    declaredValue: 2000,
    assetId: 'PRT-55230',
    serialPartial: 'SN••••8890',
    ownershipVerified: true,
    rentalHistory: 34,
    damageHistory: 'Minor stains on linens',
    pickup: 'Dallas, TX - approximate location shown until booking',
    delivery: 'Delivery + setup available for $75 within 25 miles',
    cancellation: 'Free cancellation up to 72 hours before event',
    reviews: makeReviews('l5', 67),
    deposit: 300,
    lat: 32.78,
    lng: -96.85,
  },
  {
    id: 'l6',
    title: 'Trek Full Suspension Mountain Bike',
    category: 'Sports',
    images: [
      'https://images.pexels.com/photos/36450314/pexels-photo-36450314.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/16998814/pexels-photo-16998814.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/11885686/pexels-photo-11885686.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 45,
    distance: 1.9,
    distanceUnit: 'mi',
    owner: users[3],
    rating: 4.8,
    reviewCount: 38,
    rentalCount: 22,
    available: true,
    instantBooking: false,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'Trek Fuel EX 8, full suspension trail bike. Size L. Recently serviced with new brake pads and fresh tubeless sealant. Helmet and lock included.',
    whatsIncluded: ['Mountain bike', 'Helmet', 'Lock', 'Patch kit', 'Mini pump'],
    components: [
      { name: 'Bike', present: true },
      { name: 'Helmet', present: true },
      { name: 'Lock', present: true },
      { name: 'Patch kit', present: true },
      { name: 'Mini pump', present: true },
    ],
    declaredValue: 2800,
    assetId: 'SPT-66340',
    serialPartial: 'SN••••2256',
    ownershipVerified: true,
    rentalHistory: 22,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 15 miles for $25',
    cancellation: 'Free cancellation up to 48 hours before pickup',
    reviews: makeReviews('l6', 38),
    deposit: 600,
    lat: 32.82,
    lng: -96.92,
  },
  {
    id: 'l7',
    title: 'Self-Propelled Lawn Mower',
    category: 'Garden',
    images: [
      'https://images.pexels.com/photos/37554739/pexels-photo-37554739.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/4162016/pexels-photo-4162016.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/5163429/pexels-photo-5163429.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 30,
    distance: 2.7,
    distanceUnit: 'mi',
    owner: users[6],
    rating: 4.8,
    reviewCount: 54,
    rentalCount: 73,
    available: false,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: false,
    condition: 'Good',
    description: 'Honda self-propelled mower with bagging and mulching options. 21" cutting deck. Recently serviced with fresh oil and new air filter.',
    whatsIncluded: ['Mower', 'Gas can (full)', 'Bag', 'Oil'],
    components: [
      { name: 'Mower', present: true },
      { name: 'Gas can', present: true },
      { name: 'Bag', present: true },
      { name: 'Oil', present: true },
    ],
    declaredValue: 500,
    assetId: 'GRD-77450',
    serialPartial: 'SN••••3398',
    ownershipVerified: true,
    rentalHistory: 73,
    damageHistory: 'Minor paint chips',
    pickup: 'Coppell, TX - approximate location shown until booking',
    delivery: 'Pickup only',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l7', 54),
    deposit: 150,
    lat: 32.95,
    lng: -96.99,
  },
  {
    id: 'l8',
    title: 'BOB Revolution Stroller + Car Seat',
    category: 'Baby',
    images: [
      'https://images.pexels.com/photos/5997705/pexels-photo-5997705.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/15501373/pexels-photo-15501373.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/22491728/pexels-photo-22491728.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 15,
    distance: 1.2,
    distanceUnit: 'mi',
    owner: users[5],
    rating: 5.0,
    reviewCount: 31,
    rentalCount: 28,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'BOB Revolution jogging stroller with infant car seat adapter. Clean, sanitized, and safety-checked. Great for travel or trying before you buy.',
    whatsIncluded: ['Jogging stroller', 'Car seat adapter', 'Weather shield', 'Storage basket'],
    components: [
      { name: 'Stroller', present: true },
      { name: 'Car seat adapter', present: true },
      { name: 'Weather shield', present: true },
      { name: 'Storage basket', present: true },
    ],
    declaredValue: 400,
    assetId: 'BBY-88560',
    serialPartial: 'SN••••5567',
    ownershipVerified: true,
    rentalHistory: 28,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 10 miles for $10',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l8', 31),
    deposit: 100,
    lat: 32.83,
    lng: -96.95,
  },
  {
    id: 'l9',
    title: 'Fender Stratocaster + Boss Katana Amp',
    category: 'Music',
    images: [
      'https://images.pexels.com/photos/35486274/pexels-photo-35486274.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/3755771/pexels-photo-3755771.png?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/8197270/pexels-photo-8197270.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 40,
    distance: 3.5,
    distanceUnit: 'mi',
    owner: users[4],
    rating: 4.7,
    reviewCount: 45,
    rentalCount: 67,
    available: true,
    instantBooking: false,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: false,
    condition: 'Very Good',
    description: 'American Professional Stratocaster with Boss Katana 100W amp. Includes cable, strap, picks, and gig bag. Perfect for gigs or studio sessions.',
    whatsIncluded: ['Fender Stratocaster', 'Boss Katana 100W amp', 'Instrument cable', 'Strap', 'Picks', 'Gig bag'],
    components: [
      { name: 'Guitar', present: true },
      { name: 'Amplifier', present: true },
      { name: 'Cable', present: true },
      { name: 'Strap', present: true },
      { name: 'Picks', present: true },
      { name: 'Gig bag', present: true },
    ],
    declaredValue: 1500,
    assetId: 'MUS-99670',
    serialPartial: 'SN••••7712',
    ownershipVerified: true,
    rentalHistory: 67,
    damageHistory: 'Minor fret wear',
    pickup: 'Dallas, TX - approximate location shown until booking',
    delivery: 'Pickup only',
    cancellation: 'Free cancellation up to 48 hours before pickup',
    reviews: makeReviews('l9', 45),
    deposit: 400,
    lat: 32.79,
    lng: -96.84,
  },
  {
    id: 'l10',
    title: 'Pioneer DDJ-1000 DJ Controller',
    category: 'Music',
    images: [
      'https://images.pexels.com/photos/1481316/pexels-photo-1481316.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/34307990/pexels-photo-34307990.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/6942388/pexels-photo-6942388.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 75,
    distance: 5.1,
    distanceUnit: 'mi',
    owner: users[4],
    rating: 4.9,
    reviewCount: 33,
    rentalCount: 19,
    available: true,
    instantBooking: false,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'Professional 4-channel DJ controller with full-size jog wheels. Rekordbox compatible. Includes laptop stand, cables, and padded case.',
    whatsIncluded: ['DJ controller', 'USB cable', 'Power supply', 'Laptop stand', 'Padded case'],
    components: [
      { name: 'Controller', present: true },
      { name: 'USB cable', present: true },
      { name: 'Power supply', present: true },
      { name: 'Laptop stand', present: true },
      { name: 'Padded case', present: true },
    ],
    declaredValue: 1300,
    assetId: 'MUS-10780',
    serialPartial: 'SN••••4489',
    ownershipVerified: true,
    rentalHistory: 19,
    damageHistory: 'None',
    pickup: 'Plano, TX - approximate location shown until booking',
    delivery: 'Delivery available within 20 miles for $30',
    cancellation: 'Free cancellation up to 48 hours before pickup',
    reviews: makeReviews('l10', 33),
    deposit: 350,
    lat: 33.02,
    lng: -96.7,
  },
  {
    id: 'l11',
    title: 'Meta Quest 3 VR Headset (128GB)',
    category: 'Electronics',
    images: [
      'https://images.pexels.com/photos/36812934/pexels-photo-36812934.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/7864434/pexels-photo-7864434.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/7561900/pexels-photo-7561900.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 30,
    distance: 0.6,
    distanceUnit: 'mi',
    owner: users[7],
    rating: 4.9,
    reviewCount: 24,
    rentalCount: 18,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Like New',
    description: 'Meta Quest 3 with controllers and silicone face cover. Sanitized between rentals. Pre-loaded with popular games and apps.',
    whatsIncluded: ['VR headset', 'Controllers ×2', 'Charging cable', 'Silicone face cover', 'Carrying case'],
    components: [
      { name: 'Headset', present: true },
      { name: 'Controller #1', present: true },
      { name: 'Controller #2', present: true },
      { name: 'Charging cable', present: true },
      { name: 'Face cover', present: true },
      { name: 'Carrying case', present: true },
    ],
    declaredValue: 500,
    assetId: 'ELC-11890',
    serialPartial: 'SN••••9923',
    ownershipVerified: true,
    rentalHistory: 18,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 10 miles for $10',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l11', 24),
    deposit: 150,
    lat: 32.81,
    lng: -96.95,
  },
  {
    id: 'l12',
    title: 'KitchenAid Stand Mixer + Attachments',
    category: 'Home',
    images: [
      'https://images.pexels.com/photos/6996340/pexels-photo-6996340.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/6996347/pexels-photo-6996347.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
      'https://images.pexels.com/photos/6996344/pexels-photo-6996344.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop',
    ],
    pricePerDay: 20,
    distance: 1.8,
    distanceUnit: 'mi',
    owner: users[5],
    rating: 5.0,
    reviewCount: 19,
    rentalCount: 15,
    available: true,
    instantBooking: true,
    verifiedOwner: true,
    protectionEligible: true,
    deliveryAvailable: true,
    condition: 'Excellent',
    description: 'KitchenAid Artisan 5-qt stand mixer with paddle, whisk, and dough hook. Also includes pasta roller and meat grinder attachments.',
    whatsIncluded: ['Stand mixer', 'Paddle attachment', 'Whisk', 'Dough hook', 'Pasta roller', 'Meat grinder'],
    components: [
      { name: 'Mixer', present: true },
      { name: 'Paddle', present: true },
      { name: 'Whisk', present: true },
      { name: 'Dough hook', present: true },
      { name: 'Pasta roller', present: true },
      { name: 'Meat grinder', present: true },
    ],
    declaredValue: 600,
    assetId: 'HME-12901',
    serialPartial: 'SN••••6634',
    ownershipVerified: true,
    rentalHistory: 15,
    damageHistory: 'None',
    pickup: 'Irving, TX - approximate location shown until booking',
    delivery: 'Delivery available within 10 miles for $10',
    cancellation: 'Free cancellation up to 24 hours before pickup',
    reviews: makeReviews('l12', 19),
    deposit: 150,
    lat: 32.84,
    lng: -96.93,
  },
];

export const currentUser: User = {
  id: 'me',
  name: 'John Smith',
  avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
  rating: 4.9,
  rentals: 31,
  responseRate: 96,
  verified: true,
  joinedYear: 2023,
  bio: 'Weekend project warrior and occasional photographer. I rent more than I buy.',
  onTimeReturns: 30,
  unresolvedClaims: 0,
};

export const myBookings: Booking[] = [
  {
    id: 'b1',
    listing: listings[0],
    startDate: 'Aug 28',
    endDate: 'Aug 29',
    status: 'upcoming',
    total: 95,
    pickupTime: '2:00 PM',
    isOwner: false,
  },
  {
    id: 'b2',
    listing: listings[10],
    startDate: 'Sep 3',
    endDate: 'Sep 5',
    status: 'upcoming',
    total: 75,
    pickupTime: '10:00 AM',
    isOwner: false,
  },
  {
    id: 'b3',
    listing: listings[1],
    startDate: 'Aug 15',
    endDate: 'Aug 16',
    status: 'past',
    total: 25,
    pickupTime: '9:00 AM',
    isOwner: false,
  },
  {
    id: 'b4',
    listing: listings[3],
    startDate: 'Jul 20',
    endDate: 'Jul 22',
    status: 'past',
    total: 80,
    pickupTime: '8:00 AM',
    isOwner: false,
  },
];

export const ownerBookings: Booking[] = [
  {
    id: 'ob1',
    listing: listings[0],
    startDate: 'Aug 28',
    endDate: 'Aug 29',
    status: 'upcoming',
    total: 85,
    pickupTime: '2:00 PM',
    isOwner: true,
  },
  {
    id: 'ob2',
    listing: listings[0],
    startDate: 'Sep 1',
    endDate: 'Sep 3',
    status: 'active',
    total: 170,
    pickupTime: '10:00 AM',
    isOwner: true,
  },
  {
    id: 'ob3',
    listing: listings[0],
    startDate: 'Sep 7',
    endDate: 'Sep 9',
    status: 'upcoming',
    total: 170,
    pickupTime: '11:00 AM',
    isOwner: true,
  },
];

export const rentalRequests: RentalRequest[] = [
  {
    id: 'rq1',
    listingTitle: 'Sony A7 IV Mirrorless Camera',
    renterName: 'John Smith',
    renterAvatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    renterRating: 4.9,
    renterRentals: 23,
    renterVerified: true,
    renterClaims: 0,
    startDate: 'Aug 28',
    endDate: 'Aug 29',
    total: 170,
    status: 'pending',
  },
  {
    id: 'rq2',
    listingTitle: 'Sony A7 IV Mirrorless Camera',
    renterName: 'Maria Garcia',
    renterAvatar: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    renterRating: 4.7,
    renterRentals: 12,
    renterVerified: true,
    renterClaims: 1,
    startDate: 'Sep 12',
    endDate: 'Sep 14',
    total: 255,
    status: 'pending',
  },
];

export const claims: Claim[] = [
  {
    id: 'RNT-48291',
    listingTitle: 'Sony A7 IV Mirrorless Camera',
    issue: 'Missing 24–70mm lens',
    amount: 900,
    status: 'under-review',
    date: 'Aug 22, 2026',
    timeline: [
      { step: 'Issue reported', done: true },
      { step: 'Evidence submitted', done: true },
      { step: 'Renter notified', done: true },
      { step: 'Renter responded', done: true },
      { step: 'Review', done: false, current: true },
      { step: 'Resolution', done: false },
    ],
  },
  {
    id: 'RNT-47120',
    listingTitle: 'DeWalt 20V Cordless Drill Kit',
    issue: 'Battery #2 not holding charge',
    amount: 80,
    status: 'resolved',
    date: 'Aug 10, 2026',
    timeline: [
      { step: 'Issue reported', done: true },
      { step: 'Evidence submitted', done: true },
      { step: 'Renter notified', done: true },
      { step: 'Renter responded', done: true },
      { step: 'Review', done: true },
      { step: 'Resolution', done: true },
    ],
  },
];

export const needRequests: NeedRequest[] = [
  { id: 'nr1', title: 'I need a projector', when: 'Saturday', location: 'Irving, TX', budget: 40, renter: 'Mike T.', avatar: 'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', postedAgo: '15 min ago', offers: 2 },
  { id: 'nr2', title: 'I need a pressure washer', when: 'This weekend', location: 'Dallas, TX', budget: 35, renter: 'Jessica L.', avatar: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', postedAgo: '1 hour ago', offers: 0 },
  { id: 'nr3', title: 'I need 20 folding chairs', when: 'Sep 15', location: 'Las Colinas, TX', budget: 50, renter: 'Carlos M.', avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', postedAgo: '2 hours ago', offers: 1 },
  { id: 'nr4', title: 'I need a kayak', when: 'Labor Day weekend', location: 'Grapevine, TX', budget: 45, renter: 'Beth R.', avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', postedAgo: '3 hours ago', offers: 0 },
  { id: 'nr5', title: 'I need a DJ controller', when: 'Saturday night', location: 'Dallas, TX', budget: 80, renter: 'Ahmed S.', avatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', postedAgo: '5 hours ago', offers: 3 },
];

export const conversations: Conversation[] = [
  {
    id: 'c1',
    name: 'Alex Rivera',
    avatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    listingTitle: 'Sony A7 IV Mirrorless Camera',
    listingImage: 'https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    lastMessage: 'Sounds great, see you at 2 PM!',
    lastTime: '1h',
    unread: 2,
    messages: [
      { id: 'm1', sender: 'them', text: 'Hi John! I got your rental request for Aug 28–29.', time: '10:32 AM' },
      { id: 'm2', sender: 'me', text: 'Hi Alex! Yes, excited to try the A7 IV for a wedding shoot.', time: '10:45 AM' },
      { id: 'm3', sender: 'them', text: 'Great use case. The lens is clean and ready to go.', time: '10:46 AM' },
      { id: 'm4', sender: 'them', text: 'Pickup at my place in Irving works best. 2 PM on the 28th?', time: '10:47 AM' },
      { id: 'm5', sender: 'me', text: '2 PM works perfectly. I will bring my own SD cards.', time: '11:02 AM' },
      { id: 'm6', sender: 'system', text: 'Keep payment and communication inside the platform to stay protected.', time: '11:03 AM' },
      { id: 'm7', sender: 'them', text: 'Sounds great, see you at 2 PM!', time: '11:15 AM' },
    ],
  },
  {
    id: 'c2',
    name: 'Lily Zhang',
    avatar: 'https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    listingTitle: 'Meta Quest 3 VR Headset',
    listingImage: 'https://images.pexels.com/photos/36812934/pexels-photo-36812934.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    lastMessage: 'The headset is fully charged and sanitized.',
    lastTime: '3h',
    unread: 0,
    messages: [
      { id: 'm1', sender: 'them', text: 'Your Quest 3 is ready for pickup Sep 3!', time: '2:00 PM' },
      { id: 'm2', sender: 'me', text: 'Awesome, I will be there at 10 AM.', time: '2:15 PM' },
      { id: 'm3', sender: 'them', text: 'The headset is fully charged and sanitized.', time: '2:16 PM' },
    ],
  },
  {
    id: 'c3',
    name: 'Marcus Johnson',
    avatar: 'https://images.pexels.com/photos/6975099/pexels-photo-6975099.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    listingTitle: 'DeWalt 20V Cordless Drill Kit',
    listingImage: 'https://images.pexels.com/photos/30413428/pexels-photo-30413428.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop',
    lastMessage: 'Thanks for returning it on time!',
    lastTime: '1d',
    unread: 0,
    messages: [
      { id: 'm1', sender: 'me', text: 'Drill worked great, returning it now.', time: 'Yesterday' },
      { id: 'm2', sender: 'them', text: 'Thanks for returning it on time!', time: 'Yesterday' },
    ],
  },
];

export const checkInSteps = [
  { id: 1, label: 'Photograph item', icon: 'Camera' },
  { id: 2, label: 'Photograph serial number', icon: 'Hash' },
  { id: 3, label: 'Confirm components', icon: 'CheckSquare' },
  { id: 4, label: 'Record condition', icon: 'ClipboardCheck' },
  { id: 5, label: 'Hand off item', icon: 'Handshake' },
];

export const checkOutSteps = [
  { id: 1, label: 'Photograph item', icon: 'Camera' },
  { id: 2, label: 'Confirm components', icon: 'CheckSquare' },
  { id: 3, label: 'Record condition', icon: 'ClipboardCheck' },
  { id: 4, label: 'Return item', icon: 'PackageCheck' },
];

export interface Bid {
  id: string;
  bidder: string;
  avatar: string;
  amount: number;
  time: string;
  isLeading: boolean;
}

export interface AuctionListing {
  id: string;
  title: string;
  image: string;
  category: string;
  startingPrice: number;
  currentBid: number;
  bids: Bid[];
  endsIn: string;
  endsInHours: number;
  distance: number;
  owner: string;
  ownerAvatar: string;
  rating: number;
  verified: boolean;
  protectionEligible: boolean;
  rentalDays: number;
  watchers: number;
}

export const auctions: AuctionListing[] = [
  {
    id: 'a1',
    title: 'Sony A7 IV Mirrorless Camera',
    image: 'https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop',
    category: 'Cameras',
    startingPrice: 60,
    currentBid: 82,
    rentalDays: 3,
    endsIn: '2h 14m',
    endsInHours: 2,
    distance: 0.8,
    owner: 'Alex Rivera',
    ownerAvatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    rating: 4.9,
    verified: true,
    protectionEligible: true,
    watchers: 14,
    bids: [
      { id: 'b1', bidder: 'Mike T.', avatar: 'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 62, time: '5h ago', isLeading: false },
      { id: 'b2', bidder: 'Jessica L.', avatar: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 68, time: '4h ago', isLeading: false },
      { id: 'b3', bidder: 'Tom B.', avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 75, time: '3h ago', isLeading: false },
      { id: 'b4', bidder: 'Nina K.', avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 82, time: '1h ago', isLeading: true },
    ],
  },
  {
    id: 'a2',
    title: 'Pioneer DDJ-1000 DJ Controller',
    image: 'https://images.pexels.com/photos/1481316/pexels-photo-1481316.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop',
    category: 'Music',
    startingPrice: 50,
    currentBid: 68,
    rentalDays: 2,
    endsIn: '5h 42m',
    endsInHours: 6,
    distance: 5.1,
    owner: 'David Kim',
    ownerAvatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    rating: 4.7,
    verified: true,
    protectionEligible: true,
    watchers: 8,
    bids: [
      { id: 'b1', bidder: 'Ahmed S.', avatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 52, time: '6h ago', isLeading: false },
      { id: 'b2', bidder: 'Beth R.', avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 60, time: '4h ago', isLeading: false },
      { id: 'b3', bidder: 'Carlos M.', avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 68, time: '2h ago', isLeading: true },
    ],
  },
  {
    id: 'a3',
    title: 'Trek Full Suspension Mountain Bike',
    image: 'https://images.pexels.com/photos/36450314/pexels-photo-36450314.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop',
    category: 'Sports',
    startingPrice: 30,
    currentBid: 42,
    rentalDays: 3,
    endsIn: '1d 3h',
    endsInHours: 27,
    distance: 1.9,
    owner: 'Priya Patel',
    ownerAvatar: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    rating: 4.9,
    verified: true,
    protectionEligible: true,
    watchers: 5,
    bids: [
      { id: 'b1', bidder: 'Mike T.', avatar: 'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 32, time: '1d ago', isLeading: false },
      { id: 'b2', bidder: 'Jenny P.', avatar: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 38, time: '12h ago', isLeading: false },
      { id: 'b3', bidder: 'Tom B.', avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 42, time: '6h ago', isLeading: true },
    ],
  },
  {
    id: 'a4',
    title: '4K Ultra Short Throw Projector',
    image: 'https://images.pexels.com/photos/5515482/pexels-photo-5515482.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop',
    category: 'Electronics',
    startingPrice: 40,
    currentBid: 55,
    rentalDays: 2,
    endsIn: '8h 20m',
    endsInHours: 8,
    distance: 2.3,
    owner: 'Lily Zhang',
    ownerAvatar: 'https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    rating: 4.9,
    verified: true,
    protectionEligible: true,
    watchers: 11,
    bids: [
      { id: 'b1', bidder: 'Carlos M.', avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 42, time: '8h ago', isLeading: false },
      { id: 'b2', bidder: 'Nina K.', avatar: 'https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 48, time: '5h ago', isLeading: false },
      { id: 'b3', bidder: 'Ahmed S.', avatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop', amount: 55, time: '2h ago', isLeading: true },
    ],
  },
];
