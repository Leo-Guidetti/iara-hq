alter role authenticator set pgrst.db_schemas = 'public, graphql_public, airton';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';;
