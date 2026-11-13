-- Seed the 24 fates (spec section 3). Tier equals the act the fate card belongs to.
-- card_id is the Buried Giant card id; complexity is filled in when cards are imported (phase 5).
INSERT INTO "fates" ("name", "tier", "act", "card_id", "sort_order") VALUES
  ('Steward', 'A', 1, 'ARCS-FATE01', 1),
  ('Founder', 'A', 1, 'ARCS-FATE02', 2),
  ('Magnate', 'A', 1, 'ARCS-FATE03', 3),
  ('Advocate', 'A', 1, 'ARCS-FATE04', 4),
  ('Caretaker', 'A', 1, 'ARCS-FATE05', 5),
  ('Partisan', 'A', 1, 'ARCS-FATE06', 6),
  ('Admiral', 'A', 1, 'ARCS-FATE07', 7),
  ('Believer', 'A', 1, 'ARCS-FATE08', 8),
  ('Pathfinder', 'B', 2, 'ARCS-FATE09', 9),
  ('Hegemon', 'B', 2, 'ARCS-FATE10', 10),
  ('Planet Breaker', 'B', 2, 'ARCS-FATE11', 11),
  ('Pirate', 'B', 2, 'ARCS-FATE12', 12),
  ('Blight Speaker', 'B', 2, 'ARCS-FATE13', 13),
  ('Pacifist', 'B', 2, 'ARCS-FATE14', 14),
  ('Peacekeeper', 'B', 2, 'ARCS-FATE15', 15),
  ('Warden', 'B', 2, 'ARCS-FATE16', 16),
  ('Overlord', 'C', 3, 'ARCS-FATE17', 17),
  ('Survivalist', 'C', 3, 'ARCS-FATE18', 18),
  ('Redeemer', 'C', 3, 'ARCS-FATE19', 19),
  ('Guardian', 'C', 3, 'ARCS-FATE20', 20),
  ('Naturalist', 'C', 3, 'ARCS-FATE21', 21),
  ('Gate Wraith', 'C', 3, 'ARCS-FATE22', 22),
  ('Conspirator', 'C', 3, 'ARCS-FATE23', 23),
  ('Judge', 'C', 3, 'ARCS-FATE24', 24)
ON CONFLICT ("name") DO NOTHING;
