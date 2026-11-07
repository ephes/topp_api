WITH requested_account AS (SELECT ? AS account_id), data as
(
    SELECT ep_guid,spa_facet, spa_gender_female,spa_gender_male,spa_gender_non_binary,spa_gender_not_specified
    FROM spotifyEpisodeAggregate JOIN requested_account USING (account_id) JOIN spotifyEpisodeMetadata USING (account_id, episode_id) JOIN appleEpisodeMetadata ON (spotifyEpisodeMetadata.ep_name=appleEpisodeMetadata.ep_name AND spotifyEpisodeMetadata.account_id=appleEpisodeMetadata.account_id)
    WHERE spa_facet_type="age" AND spa_date = (SELECT max(spa_date) FROM spotifyEpisodeAggregate WHERE account_id = (SELECT account_id FROM requested_account))
)

SELECT ep_guid as guid, "female" as gender, spa_gender_female as listeners, spa_facet as age_group FROM data
UNION SELECT ep_guid as guid, "male" as gender, spa_gender_male as listeners, spa_facet as age_group FROM data
UNION SELECT ep_guid as guid, "non-binary" as gender, spa_gender_non_binary as listeners, spa_facet as age_group FROM data
UNION SELECT ep_guid as guid, "not-specified" as gender, spa_gender_not_specified as listeners, spa_facet as age_group FROM data
