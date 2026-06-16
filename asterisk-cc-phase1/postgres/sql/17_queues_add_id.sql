-- Add CSP skill id to each queue (matches webui/data/skill_queues.json).
-- Safe to re-run.

ALTER TABLE queues ADD COLUMN IF NOT EXISTS id INT;

UPDATE queues SET id = 1  WHERE name = 'angliyskaya';
UPDATE queues SET id = 2  WHERE name = 'uzbekskaya';
UPDATE queues SET id = 3  WHERE name = 'crbt_taj';
UPDATE queues SET id = 4  WHERE name = 'testing_skill';
UPDATE queues SET id = 5  WHERE name = 'corporate_state';
UPDATE queues SET id = 6  WHERE name = 'ishodyashiye';
UPDATE queues SET id = 7  WHERE name = 'tajikskaya';
UPDATE queues SET id = 8  WHERE name = 'russkaya';
UPDATE queues SET id = 9  WHERE name = 'registration_sim';
UPDATE queues SET id = 10 WHERE name = 'navichok';
UPDATE queues SET id = 11 WHERE name = 'navichok2';
UPDATE queues SET id = 12 WHERE name = 'rukovoditeli';
UPDATE queues SET id = 13 WHERE name = 'tech';
UPDATE queues SET id = 14 WHERE name = 'mtt_cc';
UPDATE queues SET id = 15 WHERE name = 'aiwa_mobile';
UPDATE queues SET id = 16 WHERE name = 'crbt_rus';
UPDATE queues SET id = 17 WHERE name = 'babilon_mobile';
UPDATE queues SET id = 18 WHERE name = 'babilon_mobile1';
UPDATE queues SET id = 19 WHERE name = 'babilon_mobile2';
UPDATE queues SET id = 20 WHERE name = 'vip';
UPDATE queues SET id = 21 WHERE name = 'mbtrus';
UPDATE queues SET id = 22 WHERE name = 'kassa';
UPDATE queues SET id = 23 WHERE name = 'zolotaya_korona';
UPDATE queues SET id = 24 WHERE name = 'mobi_tel';
UPDATE queues SET id = 25 WHERE name = 'dealer_bm';
UPDATE queues SET id = 26 WHERE name = 'mr_avval';
UPDATE queues SET id = 27 WHERE name = 'mbt_rus2';
UPDATE queues SET id = 28 WHERE name = 'dealers';
UPDATE queues SET id = 29 WHERE name = 'queue6262';
UPDATE queues SET id = 30 WHERE name = 'dispecher6464';
UPDATE queues SET id = 31 WHERE name = 'testing_number';
UPDATE queues SET id = 32 WHERE name = 'new_skill';
UPDATE queues SET id = 33 WHERE name = 'ivr';
UPDATE queues SET id = 34 WHERE name = 'mybabilon';
UPDATE queues SET id = 35 WHERE name = 'volte';
UPDATE queues SET id = 36 WHERE name = 'test_yuztek';

-- Legacy demo queues (not in CSP Telephony Call list)
UPDATE queues SET id = 901 WHERE name = 'support'  AND id IS NULL;
UPDATE queues SET id = 902 WHERE name = 'sales'    AND id IS NULL;
UPDATE queues SET id = 903 WHERE name = 'billing'  AND id IS NULL;
UPDATE queues SET id = 904 WHERE name = 'overflow' AND id IS NULL;

-- Any remaining rows without id
UPDATE queues SET id = 9000 + abs(hashtext(name)::int) % 100000
WHERE id IS NULL;

ALTER TABLE queues ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS queues_id_uidx ON queues (id);

COMMENT ON COLUMN queues.id IS 'CSP Skill Queue id (see webui/data/skill_queues.json)';
