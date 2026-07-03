import django.db.models.deletion
from django.db import migrations, models


def delete_board_game_rows(apps, schema_editor):
    """Drop legacy BOARD_GAME-targeted rows (event_listing is null) so the
    column can be made non-null. No data preservation — dev only."""
    WantGroupItem = apps.get_model("trades", "WantGroupItem")
    WantBid = apps.get_model("trades", "WantBid")
    WantGroupItem.objects.filter(event_listing__isnull=True).delete()
    WantBid.objects.filter(event_listing__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0001_initial"),
        ("trades", "0006_remove_offergroupitem_money_amount_and_more"),
    ]

    operations = [
        migrations.RunPython(delete_board_game_rows, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="wantbid",
            name="uniq_wantbid_user_event_game",
        ),
        migrations.RemoveConstraint(
            model_name="wantbid",
            name="uniq_wantbid_user_event_listing",
        ),
        migrations.RemoveField(
            model_name="wantgroupitem",
            name="target_type",
        ),
        migrations.RemoveField(
            model_name="wantgroupitem",
            name="board_game",
        ),
        migrations.RemoveField(
            model_name="wantbid",
            name="target_type",
        ),
        migrations.RemoveField(
            model_name="wantbid",
            name="board_game",
        ),
        migrations.AlterField(
            model_name="wantgroupitem",
            name="event_listing",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="want_memberships",
                to="events.eventlisting",
            ),
        ),
        migrations.AlterField(
            model_name="wantbid",
            name="event_listing",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="want_bids",
                to="events.eventlisting",
            ),
        ),
        migrations.AddConstraint(
            model_name="wantbid",
            constraint=models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                name="uniq_wantbid_user_event_listing",
            ),
        ),
    ]
