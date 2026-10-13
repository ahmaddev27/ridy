<?php

namespace Tests\Unit;

use App\Domain\Fleet\Earnings\EarnerFigures;
use App\Domain\Fleet\Earnings\EarningsClassifier;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;
use UnexpectedValueException;

/**
 * The classification is the fleet owner's console script, ported. These tests
 * pin its rules on fixtures built from the documented response shape; the live
 * answer is compared against his script on staging, not here.
 */
class EarningsClassifierTest extends TestCase
{
    private function node(string $name, int|string $e5, array $children = []): array
    {
        $node = ['categoryName' => $name, 'amount' => ['amountE5' => (string) $e5]];

        return $children === [] ? $node : $node + ['children' => $children];
    }

    private function classify(array $earner): EarnerFigures
    {
        return (new EarningsClassifier)->classify($earner + [
            'earnings' => null, 'payouts' => null, 'adjustmentsFromPreviousPeriods' => null,
            'reimbursements' => null, 'netOutstanding' => null, 'tripInfos' => [],
        ]);
    }

    #[Test]
    public function a_parent_is_counted_only_by_what_its_children_leave_over(): void
    {
        // 105.00 in total, of which the parts name 100.00. The 5.00 nobody
        // names is the residual and lands in the parent's own bucket (fare).
        $f = $this->classify(['earnings' => $this->node('earnings', 10_500_000, [
            $this->node('fare', 6_000_000),
            $this->node('tip', 1_000_000),
            $this->node('promotion', 3_000_000),
        ])]);

        $this->assertSame(6_500_000, $f->fare, 'residual 5.00 is added once, to fare');
        $this->assertSame(1_000_000, $f->tips);
        $this->assertSame(3_000_000, $f->promotion);
    }

    #[Test]
    public function a_parent_whose_children_add_up_is_not_counted_twice(): void
    {
        $f = $this->classify(['earnings' => $this->node('earnings', 7_000_000, [
            $this->node('fare', 6_000_000),
            $this->node('tip', 1_000_000),
        ])]);

        $this->assertSame(6_000_000, $f->fare);
        $this->assertSame(1_000_000, $f->tips);
    }

    #[Test]
    public function quests_are_promotion_and_an_unknown_child_inherits_its_parent(): void
    {
        $f = $this->classify(['earnings' => $this->node('earnings', 5_000_000, [
            $this->node('Quest_Weekly', 2_000_000),
            $this->node('boost_of_some_kind', 3_000_000),
        ])]);

        $this->assertSame(2_000_000, $f->promotion);
        $this->assertSame(3_000_000, $f->fare);
    }

    #[Test]
    public function cash_is_subtracted_from_the_payouts_and_so_is_its_residual(): void
    {
        // Uber lists a payout as a negative amount; the script turns it into a
        // positive "cash collected" figure. The -3.00 residual does the same.
        $f = $this->classify(['payouts' => $this->node('payouts', -2_300_000, [
            $this->node('cash_collected', -2_000_000),
        ])]);

        $this->assertSame(2_300_000, $f->cash);
        $this->assertSame(0, $f->fare);
    }

    #[Test]
    public function a_leaf_payout_and_reimbursements_and_adjustments_are_sorted(): void
    {
        $f = $this->classify([
            'payouts' => $this->node('payouts', -500_000),
            'reimbursements' => $this->node('reimbursements', 400_000),
            'adjustmentsFromPreviousPeriods' => $this->node('adjustments', -150_000, [
                $this->node('refund', -150_000),
            ]),
        ]);

        $this->assertSame(500_000, $f->cash);
        $this->assertSame(250_000, $f->fare, '4.00 reimbursed minus 1.50 adjusted');
    }

    #[Test]
    public function the_whole_earner_comes_out_as_documented_strings_with_the_difference(): void
    {
        $f = $this->classify([
            'earnings' => $this->node('earnings', 10_500_000, [
                $this->node('fare', 6_000_000), $this->node('tip', 1_000_000), $this->node('promotion', 3_000_000),
            ]),
            'payouts' => $this->node('payouts', -2_300_000, [$this->node('cash_collected', -2_000_000)]),
            'reimbursements' => $this->node('reimbursements', 400_000),
            'adjustmentsFromPreviousPeriods' => $this->node('adjustments', -150_000, [$this->node('x', -150_000)]),
            'netOutstanding' => ['amountE5' => '8400000', 'currencyCode' => 'EUR'],
            'tripInfos' => [
                ['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_DISTRANCE', 'value' => '12.5 km'],
                ['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_COUNT', 'value' => '67'],
            ],
        ]);

        $this->assertSame('67.50', EarnerFigures::money($f->fare));
        $this->assertSame('30.00', EarnerFigures::money($f->promotion));
        $this->assertSame('10.00', EarnerFigures::money($f->tips));
        $this->assertSame('23.00', EarnerFigures::money($f->cash));
        $this->assertSame('84.00', EarnerFigures::money($f->netOutstanding));
        $this->assertSame('0.50', EarnerFigures::money($f->difference()), '(67.50+30+10-23) - 84.00');
        $this->assertSame(67, $f->trips);
        $this->assertSame('EUR', $f->currency);
    }

    #[Test]
    public function money_is_a_two_place_dot_string_that_never_reads_as_a_thousandth(): void
    {
        $this->assertSame('664.19', EarnerFigures::money(66_419_000));
        $this->assertSame('1234.00', EarnerFigures::money(123_400_000));
        $this->assertSame('0.00', EarnerFigures::money(0));
        $this->assertSame('0.00', EarnerFigures::money(-100), 'a negative that rounds to zero has no sign');
        $this->assertSame('-0.50', EarnerFigures::money(-50_000));
        $this->assertSame('0.01', EarnerFigures::money(500), 'half rounds away from zero');
    }

    #[Test]
    public function a_missing_trip_count_is_null_and_an_unreadable_amount_stops_the_pull(): void
    {
        $this->assertNull($this->classify([])->trips);

        $this->expectException(UnexpectedValueException::class);
        $this->classify(['earnings' => ['categoryName' => 'fare', 'amount' => ['amountE5' => '12.5']]]);
    }
}
