// Default demo menu used in the cashier screen when there is no backend
// (preview mode), and offered as a "seed" from the dashboard so the owner
// can quickly fill an empty menu. Images are committed under public/food/
// so they always render without any network dependency.

import { MAIN_HALL_NAME } from "@/lib/halls";

export type DefaultOptionChoice = {
  id: string;
  name: string;
  price_delta: number;
};
export type DefaultOption = {
  id: string;
  name: string;
  required: boolean;
  multi: boolean;
  choices: DefaultOptionChoice[];
};
export type DefaultMenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category_id: string;
  image_url: string;
  is_available: boolean;
  options: DefaultOption[];
};
export type DefaultCategory = {
  id: string;
  name: string;
  display_order: number;
};

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { id: "cat-mains", name: "الأطباق الرئيسية", display_order: 1 },
  { id: "cat-sandwiches", name: "السندويشات", display_order: 2 },
  { id: "cat-pizza", name: "البيتزا", display_order: 3 },
  { id: "cat-burgers", name: "البرغر", display_order: 4 },
  { id: "cat-salads", name: "السلطات والمقبلات", display_order: 5 },
  { id: "cat-drinks", name: "المشروبات", display_order: 6 },
  { id: "cat-desserts", name: "الحلويات", display_order: 7 },
];

export const DEFAULT_MENU_ITEMS: DefaultMenuItem[] = [
  {
    id: "it-shawarma",
    name: "شاورما لحم",
    description: "لفة شاورما لحم طازج مع مخللات وصوص الثوم والبطاطس",
    price: 750,
    category_id: "cat-sandwiches",
    image_url: "/food/shawarma.jpg",
    is_available: true,
    options: [
      {
        id: "opt-size",
        name: "الحجم",
        required: true,
        multi: false,
        choices: [
          { id: "sz-small", name: "عادي", price_delta: 0 },
          { id: "sz-large", name: "كبير", price_delta: 250 },
        ],
      },
      {
        id: "opt-prefer",
        name: "التفضيلات",
        required: false,
        multi: true,
        choices: [
          { id: "pr-no-onion", name: "بدون بصل", price_delta: 0 },
          { id: "pr-no-garlic", name: "بدون صوص الثوم", price_delta: 0 },
          { id: "pr-extra-meat", name: "حشو إضافي", price_delta: 200 },
        ],
      },
    ],
  },
  {
    id: "it-shawarma-chicken",
    name: "شاورما دجاج",
    description: "دجاج مشوي متبّل مع صوص طحينة وسلطة",
    price: 650,
    category_id: "cat-sandwiches",
    image_url: "/food/shawarma-c.jpg",
    is_available: true,
    options: [
      {
        id: "opt-size2",
        name: "الحجم",
        required: true,
        multi: false,
        choices: [
          { id: "szs2-c", name: "عادي", price_delta: 0 },
          { id: "szs2-l", name: "كبير", price_delta: 200 },
        ],
      },
    ],
  },
  {
    id: "it-pizza-margherita",
    name: "بيتزا مارغريتا",
    description: "بيتزا بالصلصة والموزاريلا وأوراق الريحان",
    price: 1200,
    category_id: "cat-pizza",
    image_url: "/food/pizza.jpg",
    is_available: true,
    options: [
      {
        id: "opt-pizza-size",
        name: "المقاس",
        required: true,
        multi: false,
        choices: [
          { id: "pz-med", name: "وسط", price_delta: 0 },
          { id: "pz-lrg", name: "كبيرة", price_delta: 400 },
        ],
      },
      {
        id: "opt-pizza-top",
        name: "إضافات",
        required: false,
        multi: true,
        choices: [
          { id: "pt-cheese", name: "جبنة إضافية", price_delta: 250 },
          { id: "pt-pep", name: "بيبروني", price_delta: 300 },
          { id: "pt-mush", name: "مشروم", price_delta: 150 },
        ],
      },
    ],
  },
  {
    id: "it-burger",
    name: "برغر لحم",
    description: "قطعة لحم بقري مع جبنة، خس، طماطم وصوص خاص",
    price: 950,
    category_id: "cat-burgers",
    image_url: "/food/burger.jpg",
    is_available: true,
    options: [
      {
        id: "opt-burger-done",
        name: "درجة التسوية",
        required: true,
        multi: false,
        choices: [
          { id: "bd-mid", name: "وسط", price_delta: 0 },
          { id: "bd-well", name: "مستوي جيداً", price_delta: 0 },
        ],
      },
      {
        id: "opt-burger-add",
        name: "إضافات",
        required: false,
        multi: true,
        choices: [
          { id: "ba-cheese", name: "جبنة مضاعفة", price_delta: 200 },
          { id: "ba-bacon", name: "بقّون", price_delta: 350 },
        ],
      },
    ],
  },
  {
    id: "it-caesar",
    name: "سلطة سيزر",
    description: "خس روماني، دجاج مشوي، خبز محمص وصوص سيزر",
    price: 800,
    category_id: "cat-salads",
    image_url: "/food/caesar.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-fries",
    name: "فرينش فرايز",
    description: "بطاطس مقلية ذهبية مع صوص الكاتشب والمايونيز",
    price: 450,
    category_id: "cat-salads",
    image_url: "/food/fries.jpg",
    is_available: true,
    options: [
      {
        id: "opt-fries-sauce",
        name: "صة الصوص",
        required: false,
        multi: true,
        choices: [
          { id: "fs-ketchup", name: "كاتشب", price_delta: 0 },
          { id: "fs-mayo", name: "مايونيز", price_delta: 0 },
          { id: "fs-cheese", name: "صوص جبنة", price_delta: 150 },
        ],
      },
    ],
  },
  {
    id: "it-coffee",
    name: "قهوة تركية",
    description: "قهوة تركية أصيلة تقدم مع ماء وتمور",
    price: 200,
    category_id: "cat-drinks",
    image_url: "/food/coffee.jpg",
    is_available: true,
    options: [
      {
        id: "opt-coffee-sugar",
        name: "السكر",
        required: true,
        multi: false,
        choices: [
          { id: "cs-less", name: "أقل", price_delta: 0 },
          { id: "cs-normal", name: "عادي", price_delta: 0 },
          { id: "cs-none", name: "بدون سكر", price_delta: 0 },
        ],
      },
    ],
  },
  {
    id: "it-orange",
    name: "عصير برتقال طازج",
    description: "برتقال معصور طازجاً بدون سكر مضاف",
    price: 350,
    category_id: "cat-drinks",
    image_url: "/food/orange.jpg",
    is_available: true,
    options: [
      {
        id: "opt-juice-size",
        name: "الحجم",
        required: true,
        multi: false,
        choices: [
          { id: "js-s", name: "صغير", price_delta: 0 },
          { id: "js-l", name: "كبير", price_delta: 100 },
        ],
      },
    ],
  },
  {
    id: "it-water",
    name: "مياه معدنية",
    description: "مياه معدنية 500 مل",
    price: 100,
    category_id: "cat-drinks",
    image_url: "/food/water.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-baklava",
    name: "بقلاوة",
    description: "بقلاوة بالجوز والشيرة الطازجة",
    price: 300,
    category_id: "cat-desserts",
    image_url: "/food/baklava.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-kunafa",
    name: "كنافة نابلسية",
    description: "كنافة بالجبنة والشيرة مع الفستق",
    price: 400,
    category_id: "cat-desserts",
    image_url: "/food/kunafa.jpg",
    is_available: true,
    options: [
      {
        id: "opt-kunafa-cheese",
        name: "النوع",
        required: true,
        multi: false,
        choices: [
          { id: "kc-classic", name: "بالجبنة", price_delta: 0 },
          { id: "kc-cream", name: "بالقشطة", price_delta: 100 },
        ],
      },
    ],
  },
  {
    id: "it-ice-cream",
    name: "بوظة",
    description: "بوظة بثلاث نكهات (فانيلا، شوكولاتة، فراولة)",
    price: 250,
    category_id: "cat-desserts",
    image_url: "/food/icecream.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-tajine",
    name: "طاجين دجاج",
    description: "طاجين دجاج بالليمون المخلل والزيتون على الطريقة المغربية",
    price: 1600,
    category_id: "cat-mains",
    image_url: "/food/tajine.jpg",
    is_available: true,
    options: [
      {
        id: "opt-tajine-size",
        name: "عدد الأشخاص",
        required: true,
        multi: false,
        choices: [
          { id: "tj-1", name: "شخص واحد", price_delta: 0 },
          { id: "tj-2", name: "شخصان", price_delta: 900 },
        ],
      },
      {
        id: "opt-tajine-extra",
        name: "إضافات",
        required: false,
        multi: true,
        choices: [
          { id: "tj-bread", name: "خبز إضافي", price_delta: 100 },
          { id: "tj-rice", name: "أرز", price_delta: 250 },
        ],
      },
    ],
  },
  {
    id: "it-couscous",
    name: "كسكسي بالخضار",
    description: "كسكسي مغربي بالخضار الموسمية ولحم الغنم الطري",
    price: 1500,
    category_id: "cat-mains",
    image_url: "/food/couscous.jpg",
    is_available: true,
    options: [
      {
        id: "opt-couscous-size",
        name: "عدد الأشخاص",
        required: true,
        multi: false,
        choices: [
          { id: "cc-1", name: "شخص واحد", price_delta: 0 },
          { id: "cc-2", name: "شخصان", price_delta: 800 },
        ],
      },
    ],
  },
  {
    id: "it-hummus",
    name: "حمص بالطحينة",
    description: "حمص كريمي بالطحينة وزيت الزيتون والصنوبر",
    price: 400,
    category_id: "cat-salads",
    image_url: "/food/hummus.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-tabbouleh",
    name: "سلطة تبولة",
    description: "بقدونس وبرغل وطماطم وعصير ليمون",
    price: 450,
    category_id: "cat-salads",
    image_url: "/food/tabbouleh.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-tea",
    name: "شاي أخضر",
    description: "شاي أخضر مغربي بالنعناع الطازج",
    price: 150,
    category_id: "cat-drinks",
    image_url: "/food/tea.jpg",
    is_available: true,
    options: [
      {
        id: "opt-tea-sugar",
        name: "السكر",
        required: true,
        multi: false,
        choices: [
          { id: "th-none", name: "بدون سكر", price_delta: 0 },
          { id: "th-low", name: "أقل", price_delta: 0 },
          { id: "th-normal", name: "عادي", price_delta: 0 },
        ],
      },
    ],
  },
  {
    id: "it-lemonade",
    name: "عصير ليمون بالنعناع",
    description: "عصير ليمون طازج بارد مع أوراق النعناع",
    price: 300,
    category_id: "cat-drinks",
    image_url: "/food/lemonade.jpg",
    is_available: true,
    options: [
      {
        id: "opt-lemon-size",
        name: "الحجم",
        required: true,
        multi: false,
        choices: [
          { id: "lm-s", name: "صغير", price_delta: 0 },
          { id: "lm-l", name: "كبير", price_delta: 100 },
        ],
      },
    ],
  },
  {
    id: "it-donut",
    name: "دونات",
    description: "دونات محشوة بالمربى ومغطاة بالسكر البودرة",
    price: 350,
    category_id: "cat-desserts",
    image_url: "/food/donut.jpg",
    is_available: true,
    options: [],
  },
  {
    id: "it-cake",
    name: "شريحة كيك شوكولاتة",
    description: "كيك شوكولاتة غني بطبقة جاناش",
    price: 500,
    category_id: "cat-desserts",
    image_url: "/food/cake.jpg",
    is_available: true,
    options: [],
  },
];

// Map preview menu to the cashier component's expected shape.
export function buildDefaultCashierMenu() {
  const previewHalls = [
    { id: "main", name: MAIN_HALL_NAME, table_count: 5 },
    { id: "vip", name: "قاعة VIP", table_count: 3 },
  ];
  const previewTables = [
    { id: "t1", table_number: 1, hall_id: "main" },
    { id: "t2", table_number: 2, hall_id: "main" },
    { id: "t3", table_number: 3, hall_id: "main" },
    { id: "t4", table_number: 4, hall_id: "main" },
    { id: "t5", table_number: 5, hall_id: "main" },
    { id: "t6", table_number: 1, hall_id: "vip" },
    { id: "t7", table_number: 2, hall_id: "vip" },
    { id: "t8", table_number: 3, hall_id: "vip" },
  ];
  return {
    categories: DEFAULT_CATEGORIES,
    items: DEFAULT_MENU_ITEMS.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      price: i.price,
      category_id: i.category_id,
      image_url: i.image_url,
      is_available: i.is_available,
    })),
    halls: previewHalls,
    tables: previewTables.map((t) => ({
      ...t,
      hall_name: previewHalls.find((h) => h.id === t.hall_id)!.name,
    })),
    options: DEFAULT_MENU_ITEMS.reduce<Record<string, DefaultOption[]>>(
      (acc, i) => {
        acc[i.id] = i.options.map((o, oi) => ({
          id: o.id,
          name: o.name,
          required: o.required,
          multi: o.multi,
          display_order: oi,
          choices: o.choices,
        }));
        return acc;
      },
      {},
    ) as Record<string, any[]>,
  };
}
