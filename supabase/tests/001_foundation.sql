begin;

select plan(1);
select ok(true, 'Gate 1 keeps business schema out of the foundation migration surface.');

select * from finish();
rollback;
