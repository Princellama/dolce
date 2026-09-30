// New stays start with sections and a starter list of house guides.
// On first boot, Milli & Reggie's stay is loaded from Milli's notes.
const { q, one } = require('./db');

const STARTER_GUIDES = [
  ['house', 'Getting in: keys, lock codes, alarm, garage'],
  ['house', 'Wi-Fi name and password'],
  ['house', 'AC, fans and thermostat'],
  ['house', 'Stove and oven'],
  ['house', 'Laundry: washer and dryer settings'],
  ['house', 'Trash and recycling day'],
  ['house', 'Breaker box and water shut-off'],
  ['house', 'Hurricane and emergency plan'],
  ['house', 'Mail and packages'],
  ['house', 'TV and remote'],
  ['dog', 'Where the dog supplies are'],
  ['dog', 'Getting to the vet (carrier, car)'],
  ['cat', 'Where the cat food and litter are'],
];

async function addSection(stayId, kind, title, notes = '', sort = 0) {
  return one('INSERT INTO sections (stay_id,kind,title,notes,sort) VALUES ($1,$2,$3,$4,$5) RETURNING *', [stayId, kind, title, notes, sort]);
}

async function addGuide(stayId, sectionId, title, intro, steps = [], opts = {}) {
  const g = await one('INSERT INTO guides (stay_id,section_id,title,intro,suggested,sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [stayId, sectionId, title, intro || '', !!opts.suggested, opts.sort || 0]);
  let i = 0;
  for (const s of steps) {
    const [text, warning] = Array.isArray(s) ? s : [s, false];
    await q('INSERT INTO guide_steps (guide_id,text,warning,sort) VALUES ($1,$2,$3,$4)', [g.id, text, warning, i++]);
  }
  return g;
}

async function addStarterGuides(stayId, sectionsByKind, skip = []) {
  let sort = 100;
  for (const [kind, title] of STARTER_GUIDES) {
    if (skip.includes(title) || !sectionsByKind[kind]) continue;
    await addGuide(stayId, sectionsByKind[kind].id, title, '', [], { suggested: true, sort: sort++ });
  }
}

async function createStarterStay(name, ownerId) {
  const stay = await one(`INSERT INTO stays (name, arrival_text) VALUES ($1,$2) RETURNING *`,
    [name, 'Say hi to the pets.\nCheck food and water bowls.']);
  const sec = {
    dog: await addSection(stay.id, 'dog', 'Dog', '', 1),
    cat: await addSection(stay.id, 'cat', 'Cats', '', 2),
    plants: await addSection(stay.id, 'plants', 'Plants', '', 3),
    house: await addSection(stay.id, 'house', 'House', '', 4),
  };
  await addStarterGuides(stay.id, sec);
  await q(`INSERT INTO members (stay_id,user_id,role,morning_email,evening_report) VALUES ($1,$2,'owner',true,true)`, [stay.id, ownerId]);
  return stay;
}

async function task(stayId, sectionId, t) {
  return one(`INSERT INTO tasks (stay_id,section_id,title,details,warning,time_start,time_end,time_label,every_n,first_day,guide_id,optional,sort)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [stayId, sectionId, t.title, t.details || '', t.warning || '', t.start || '', t.end || '', t.label || '', t.every || 1, t.first || 1, t.guide || null, !!t.optional, t.sort || 0]);
}

async function seedMilli(admins) {
  const stay = await one(`INSERT INTO stays (name, pet_names, tz, start_date, start_time, end_date, end_time, email_time, report_time, arrival_title, arrival_text, welcome)
    VALUES ($1,$2,'Pacific/Honolulu','2026-10-02','13:30','2026-10-20','12:00','06:30','20:00',$3,$4,$5) RETURNING *`, [
    "Milli & Reggie's",
    'Dolce, Twinzy, Spicy, Miss Cutie Pie',
    'Whenever you get home',
    "Take Dolce out to pee on the grass by the light pole out front.\nGive her fresh water. She'll want a drink.\nIf she snorts later, she usually needs to go out again.",
    'Thank you so much, Kharis! Call or text us anytime.',
  ]);
  const S = stay.id;
  const dog = await addSection(S, 'dog', 'Dolce',
    "Always keep Dolce in her crate, with the fan blowing into it.\nShe snorts when she wants something. Usually it means she needs to go out.\nWalks are early and late because midday is too hot for her.\nSnacks: pieces of defrosted cooked chicken or dried salmon, up to 5 a day.\nWipes and diapers are available.\nIn an emergency, take her to one of the vets in Contacts. Milli will reimburse you.", 1);
  const cat = await addSection(S, 'cat', 'Cats', 'Three cats. They eat dry food from the automatic feeder all day, plus canned food each evening.', 2);
  const plants = await addSection(S, 'plants', 'Plants', 'Water only the plants on our side and the flower bed to the left. The water pressure is very strong, so open the spigot just over a half turn.', 3);
  const house = await addSection(S, 'house', 'House', '', 4);

  await q(`INSERT INTO pets (stay_id,section_id,name,description,sort) VALUES
    ($1,$2,'Princess Dolce','Senior girl, weak on her legs. Hold her up with the leash at curbs. Snorts when she needs to go out.',1),
    ($1,$3,'Twinzy','Tabby with a white chest. Skinny, and a scaredy cat.',2),
    ($1,$3,'Spicy','Dark black and grey tabby. Chunky.',3),
    ($1,$3,'Miss Cutie Pie','Orange. Likes to sleep on the highest level of the cat tree in front.',4)`, [S, dog.id, cat.id]);

  const walk = await addGuide(S, dog.id, 'Morning walk route',
    'About 15 to 20 minutes. She has favorite pee spots; go from one to the next and carry her when she stalls.', [
      ["Going up the sidewalk curb, hold her up with the leash. She's too weak and can hit her face on the ground.", true],
      "If she isn't up by 7:15 AM, wake her. Later is too hot for her. Brush her slowly to help her wake up.",
      'Bring her to her water bowl. Give her fresh water after each drink.',
      'First spot: the grass by the light pole out front. She usually pees here.',
      "Then she'll stare or stand still for a minute. If she doesn't move, carry her across the street to the next spot: the grassy area of the corner house.",
      "If she pees there and just stares off into space, carry her up the little hill to the fire hydrant on the corner. She may pee there, or not.",
      "She may walk to the 2nd tree. No need to go past the light pole.",
      'Coax her to walk back toward the fire hydrant, cross the street, and head home.',
    ], { sort: 1 });

  const feeder = await addGuide(S, cat.id, 'Cleaning and refilling the automatic feeder',
    'The full clean-out, step by step. The water "moat" under the feeder keeps ants out of the food.', [
      'Remove the green cover.',
      "Lift up the food canister. Careful not to lift up the bowls; they aren't connected tightly.",
      'Pick up the white plastic and stainless steel bowls together.',
      'Put any food left in the bowl back into the food canister.',
      'Wash the stainless steel bowls.',
      'Lift the lid off the canister by pulling outward on the top lid.',
      'Refill the canister with more cat food.',
      'Wash the 2 black pieces.',
      'Put the 2 black pieces back by the wall. The smaller one goes upside down. The bigger piece holds the water.',
      'Fill the brown vase with water and carry it to the 2 black pieces.',
      'Put the white and stainless steel bowls back on the black piece.',
      'Connect the food canister to the stainless steel bowl holder.',
      ['Pour water slowly into the large black container until just below the top. Do not let the water touch the machine.', true],
    ], { sort: 1 });

  const water = await addGuide(S, plants.id, 'Watering with the hose',
    'Only the plants on our side and the flower bed to the left.', [
      ['Turn the water on only slightly over a half turn. The pressure is very strong.', true],
      'Start with the hedge plants and the plants by the door.',
      'Turn off the water and release the water in the hose.',
      'Pull out 7 rings of the hose to the flower bed. Water each plant for a count of 15 seconds.',
      "Bring the hose back to the other side so it doesn't get caught by the car tires.",
      "Turn off the water and release any water in the hose. Roll the hose up backwards halfway (4 rings) so it doesn't tangle.",
      'Turn the water back on and finish the plants on our side.',
      'Turn off the spigots. Release all the water left in the hose and roll it up completely.',
    ], { sort: 1 });

  const curb = "Hold her up with the leash going up the curb. She's too weak and can hit her face.";
  await task(S, dog.id, { title: 'Morning walk', start: '07:15', end: '07:45', label: 'By 7:15 AM', guide: walk.id, warning: curb,
    details: "Wake her by 7:15 if she's still asleep; later is too hot. Brush her slowly, fresh water, then out for 15 to 20 minutes." });
  await task(S, dog.id, { title: 'Breakfast', start: '07:45', label: 'After the walk',
    details: "Half of the defrosted food (1 piece beef and 1 piece chicken, split in half; the other half is dinner). Wet it with a little water.\nWon't eat? Add a scoop of salmon bits.\nStill no? Cover the bowl with the plastic lid, refrigerate it, and offer it in the afternoon." });
  await task(S, dog.id, { title: 'Joint vitamins: 4 pieces', details: "From today's labeled container. Only 4 pieces a day. Good as snacks through the day.", sort: 1 });
  await task(S, dog.id, { title: 'Change the crate lining', details: 'Keep the fan blowing into the crate. Wipes and diapers are available.', sort: 2 });
  await task(S, dog.id, { title: 'Dinner', start: '14:00', end: '15:00',
    warning: "Won't be there by 3 PM? Give the food to Mama Luci and let her know your schedule.",
    details: "The other half of this morning's food. If she doesn't finish her food for the day, you can throw it out." });
  await task(S, dog.id, { title: "Defrost tomorrow's food", start: '14:00', end: '15:00', label: 'With dinner', sort: 1,
    details: '1 piece chicken and 1 piece beef, in the oval container with the lid. Put it in the fridge: long drawer, left side.' });
  await task(S, dog.id, { title: 'Pee break', start: '16:00', label: 'About 4 PM', details: 'Just outside, on the grass by the light pole.' });
  await task(S, dog.id, { title: 'Evening walk', start: '17:30', end: '18:00', warning: curb,
    details: "A short walk to the left, when it's not too sunny. She likes to pee across the street on the grass by the light pole. Coax her down to the corner if she'll go; if not, just walk her back home." });

  await task(S, cat.id, { title: "Pick up and wash the cats' canned-food bowl", start: '08:00', label: 'Morning', details: 'Wash it so it is ready for this evening.' });
  await task(S, cat.id, { title: 'Canned food for the cats', start: '18:00', label: 'Evening', details: 'Any flavor.' });
  await task(S, cat.id, { title: 'Feeder: fresh water, clean bowls, refill dry food', every: 2, first: 3, guide: feeder.id,
    details: 'Change the water, wash the stainless steel bowls, and top up the dry food.' });
  await task(S, cat.id, { title: "Check the feeder's water moat", every: 3, first: 4, guide: feeder.id,
    details: "It keeps ants out of the food. If the water is dirty or has evaporated (or food fell in), wash it out and wash the food bowl too; use the steel bowl to hold the food while you wash. Refill with the green watering can." });
  await task(S, plants.id, { title: 'Water the plants', every: 2, first: 2, guide: water.id,
    details: 'Plants on our side and the flower bed to the left. About 15 seconds per plant.' });

  await addStarterGuides(S, { dog, cat, plants, house }, []);

  await q(`INSERT INTO contacts (stay_id,name,role,phone,address,notes,emergency,sort) VALUES
    ($1,'Aloha Affordable Vet','Vet','808-445-3624','98-199 Kamehameha Hwy, Ste F2, Aiea, HI 96701','Appointments are booked online. Milli will reimburse you.',true,1),
    ($1,'Blue Cross Animal Hospital','Vet','808-593-2532','1318 Kapiolani Blvd, Honolulu, HI 96814','Call first to ask if they will take a walk-in. Milli will reimburse you.',true,2),
    ($1,'Milli Lumanta','Owner','808-722-4369','','Away Oct 2–20 in Japan and Korea, which are 19 hours ahead of Hawaii. Call or text anytime.',false,3),
    ($1,'Reggie Lumanta','Owner','808-308-8758','','Traveling with Milli.',false,4),
    ($1,'Mama Luci','Family','','','If you can''t be there by 3 PM, give her Dolce''s dinner and let her know your schedule.',false,5)`, [S]);

  if (admins[0]) {
    const u = await one(`INSERT INTO users (email,name) VALUES ($1,'Eric') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING *`, [admins[0]]);
    await q(`INSERT INTO members (stay_id,user_id,role,morning_email,evening_report) VALUES ($1,$2,'owner',false,false) ON CONFLICT DO NOTHING`, [S, u.id]);
  }
  return stay;
}

async function seedIfEmpty(admins) {
  const has = await one('SELECT 1 FROM stays LIMIT 1');
  if (!has) {
    await seedMilli(admins);
    console.log("Loaded Milli & Reggie's stay.");
  }
}

module.exports = { seedIfEmpty, createStarterStay, STARTER_GUIDES };
