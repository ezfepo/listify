// Tests never hit the live Spotify API or the real app.db — see plan.md §6.
process.env.LISTIFY_DB_PATH = ':memory:';
