select plan(1);

select has_column('public', 'quotes', 'signwell_document_id', 'quotes can store a SignWell document id');

select * from finish();
