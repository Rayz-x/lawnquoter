select plan(1);

select has_column('public', 'quotes', 'abandoned_at', 'quotes.abandoned_at exists');
