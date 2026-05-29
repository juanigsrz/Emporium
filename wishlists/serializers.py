from rest_framework import serializers
from .models import TradeStatement
from events.models import EventEntry, TradeEvent, EventStatus, EntryStatus


class TradeStatementSerializer(serializers.ModelSerializer):
    offer_entry_ids = serializers.PrimaryKeyRelatedField(
        queryset=EventEntry.objects.all(),
        many=True,
        source='offer_entries',
        write_only=True,
    )
    offer_entries_detail = serializers.SerializerMethodField(read_only=True)
    want_game_ids = serializers.SlugRelatedField(
        queryset=__import__('catalog').models.Game.objects.all(),
        many=True,
        source='want_games',
        slug_field='bgg_id',
        write_only=True,
    )
    want_games_detail = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = TradeStatement
        fields = [
            'id', 'event', 'owner', 'give_at_most', 'get_at_least',
            'offer_entry_ids', 'offer_entries_detail',
            'want_game_ids', 'want_games_detail',
            'want_filters', 'created_at',
        ]
        read_only_fields = ['owner', 'event', 'created_at']

    def get_offer_entries_detail(self, obj):
        return [
            {'id': e.id, 'token': e.item_token, 'listing_id': e.listing_id}
            for e in obj.offer_entries.all()
        ]

    def get_want_games_detail(self, obj):
        return [
            {'bgg_id': g.bgg_id, 'name': g.name}
            for g in obj.want_games.all()
        ]

    def validate(self, data):
        request = self.context['request']
        event = self.context['event']

        if event.status not in (EventStatus.OPEN_WANTLIST,):
            raise serializers.ValidationError('Event is not open for want list submissions.')

        offer_entries = data.get('offer_entries', [])
        give_at_most = data.get('give_at_most', 1)
        get_at_least = data.get('get_at_least', 1)

        for entry in offer_entries:
            if entry.event_id != event.id:
                raise serializers.ValidationError(
                    f'Entry {entry.id} does not belong to this event.')
            if entry.listing.owner != request.user:
                raise serializers.ValidationError(
                    f'Entry {entry.id} is not owned by you.')
            if entry.status != EntryStatus.ENTERED:
                raise serializers.ValidationError(
                    f'Entry {entry.id} is not active.')

        if not offer_entries:
            raise serializers.ValidationError('At least one offer entry required.')
        if give_at_most < 1 or give_at_most > len(offer_entries):
            raise serializers.ValidationError(
                f'give_at_most must be between 1 and {len(offer_entries)}.')
        if get_at_least < 1:
            raise serializers.ValidationError('get_at_least must be >= 1.')

        if not event.allow_bundles and (give_at_most > 1 or get_at_least > 1):
            raise serializers.ValidationError('Bundles not allowed in this event.')

        return data

    def create(self, validated_data):
        offer_entries = validated_data.pop('offer_entries')
        want_games = validated_data.pop('want_games')
        statement = TradeStatement.objects.create(**validated_data)
        statement.offer_entries.set(offer_entries)
        statement.want_games.set(want_games)
        return statement

    def update(self, instance, validated_data):
        offer_entries = validated_data.pop('offer_entries', None)
        want_games = validated_data.pop('want_games', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if offer_entries is not None:
            instance.offer_entries.set(offer_entries)
        if want_games is not None:
            instance.want_games.set(want_games)
        return instance
