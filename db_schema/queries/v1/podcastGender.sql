WITH requested_account AS (SELECT ? AS account_id), data as (
  SELECT * FROM spotifyPodcastAggregate JOIN requested_account USING (account_id) WHERE spa_facet_type="age" AND spa_date = (SELECT max(spa_date) FROM spotifyPodcastAggregate WHERE account_id = (SELECT account_id FROM requested_account))
)

SELECT "female" as gender, spa_gender_female as listeners, spa_facet as age_group FROM data
UNION SELECT "male" as gender, spa_gender_male as listeners, spa_facet as age_group FROM data
UNION SELECT "non-binary" as gender, spa_gender_non_binary as listeners, spa_facet as age_group FROM data
UNION SELECT "not-specified" as gender, spa_gender_not_specified as listeners, spa_facet as age_group FROM data
