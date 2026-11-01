export const categories = ['Еда и напитки', 'Продукты', 'Транспорт', 'Подписки', 'Развлечения', 'Здоровье', 'Образование', 'Дом и быт', 'Одежда', 'Подарки', 'Доходы', 'Другое'];

export const seedTransactions = [
  { id: 'seed-1', name: 'Кофе в Starbucks', category: 'Еда и напитки', amount: -2200, icon: 'coffee', occurredAt: '2026-11-01T10:24', note: 'Капучино' },
  { id: 'seed-2', name: 'Зарплата', category: 'Доходы', amount: 150000, icon: 'briefcase', occurredAt: '2026-10-31T09:00', note: 'Октябрь' },
  { id: 'seed-3', name: 'Продукты в Magnum', category: 'Продукты', amount: -12450, icon: 'shopping', occurredAt: '2026-10-28T18:57', note: '' },
  { id: 'seed-4', name: 'Такси', category: 'Транспорт', amount: -1800, icon: 'car', occurredAt: '2026-10-27T21:13', note: 'Домой' },
];

export const subscriptionTemplates = [
  { id: 'youtube', name: 'YouTube Premium', price: 2500, category: 'Подписки', icon: 'play', color: 'red', billingDay: 3, frequency: 'monthly' },
  { id: 'spotify', name: 'Spotify', price: 2390, category: 'Подписки', icon: 'music', color: 'green', billingDay: 7, frequency: 'monthly' },
  { id: 'netflix', name: 'Netflix', price: 4990, category: 'Подписки', icon: 'tv', color: 'red', billingDay: 12, frequency: 'monthly' },
  { id: 'icloud', name: 'iCloud+', price: 450, category: 'Подписки', icon: 'cloud', color: 'blue', billingDay: 18, frequency: 'monthly' },
];
