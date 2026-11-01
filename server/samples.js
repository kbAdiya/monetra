export function sampleTransactions(today) {
  const month = today.slice(0,7);
  const d = new Date(`${month}-01T00:00:00Z`);
  const date = (offset, day) => { const x = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,day));return x.toISOString().slice(0,10)+'T12:00'; };
  return [
    ...['StreamBox','Spotify','CloudStore'].flatMap((name,index)=>[-3,-2,-1].map(offset=>({name,amountMinor:-[300000,239000,45000][index],category:'Подписки',occurredAt:date(offset,[3,7,18][index]),note:'Демонстрационный платёж',recurring:false}))),
    {name:'CoffeeShop',amountMinor:-150000,category:'Еда и напитки',occurredAt:date(-1,1),note:'Не повтор: интервал 2 дня'},
    {name:'CoffeeShop',amountMinor:-150000,category:'Еда и напитки',occurredAt:date(-1,3),note:'Не повтор: интервал 2 дня'},
    {name:'DesignApp',amountMinor:-400000,category:'Образование',occurredAt:date(-1,15),note:'Одна операция — недостаточно данных'},
    {name:'VariableCloud',amountMinor:-200000,category:'Подписки',occurredAt:date(-2,10),note:'Изменение суммы — неоднозначный случай'},
    {name:'VariableCloud',amountMinor:-250000,category:'Подписки',occurredAt:date(-1,10),note:'Изменение суммы — неоднозначный случай'},
    {name:'Зарплата',amountMinor:15000000,category:'Доходы',occurredAt:date(-1,25),note:'Демонстрационный доход'},
  ];
}
