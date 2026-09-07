import {
  formatRate,
  measureDelegationCeiling,
  measureStakingYield,
  summarizeReliability,
  type CycleRecord,
} from '../chain/baker-record';
import { formatEdgePercent, formatStakingLimit, type BakerSnapshot } from '../chain/baker';
import { explorerAccountUrl } from '../chain/explorer';
import type { StakingConstants } from '../chain/protocol';
import type { TezzetNetwork } from '../config/networks';
import { formatTimestamp } from '../lib/format';
import { Address, Amount, ReadAt } from './primitives';

/**
 * Os números de um baker. Sem nota, sem estrela, sem "recomendado".
 *
 * Descobrir bakers dentro do Tezzet está parado por decisão de Rafael em
 * 2026-08-30 (`suite/JOURNEY.md` §6.4): uma carteira que sugere para quem
 * delegar tem conflito de interesse se quem a publica também opera um baker.
 * Então não há lista e não há ordenação — a pessoa traz um endereço e vê o
 * que a cadeia diz. Ordenar seria escolher por ela.
 */
export function BakerCard({
  baker,
  records,
  constants,
  network,
  focus,
}: {
  baker: BakerSnapshot;
  records: readonly CycleRecord[];
  constants: StakingConstants;
  network: TezzetNetwork;
  focus: 'delegating' | 'staking';
}) {
  const reliability = summarizeReliability(records);
  const stakingYield = measureStakingYield(records, constants);
  const ceiling = measureDelegationCeiling(records, constants);

  return (
    <div className="stack">
      <div className="row row--between">
        <span className="baker__name">
          {baker.alias ?? 'Sem nome registrado'}{' '}
          <Address address={baker.address} href={explorerAccountUrl(network, baker.address)} />
        </span>
        <ReadAt at={baker.readAt} indexerLevel={baker.indexerLevel} />
      </div>

      {!baker.active && (
        <p className="note note--strong">
          Este baker está <strong>desativado</strong> na cadeia. Ele não recebe direitos de bloco, e
          delegar ou stakear com ele não rende nada até que ele volte a ser ativado.
        </p>
      )}

      <div className="balance__split">
        <Cell label="Delegadores">{baker.delegatorsCount.toLocaleString('pt-BR')}</Cell>
        <Cell label="Quem stakeia">{baker.stakersCount.toLocaleString('pt-BR')}</Cell>
        <Cell label="Stake próprio do baker">
          <Amount mutez={baker.ownStaked} />
        </Cell>
        <Cell label="Última atividade">{formatTimestamp(baker.lastActivityAt)}</Cell>
      </div>

      {focus === 'delegating' ? (
        <section className="stack">
          <h3 className="baker__section">Delegar com este baker</h3>
          <div className="balance__split">
            <Cell label="Cabe de delegação">
              <Amount mutez={baker.delegationFreeSpace} />
            </Cell>
            <Cell label="Capacidade total de delegação">
              <Amount mutez={baker.delegationCapacity} />
            </Cell>
            <Cell label="Já delegado">
              <Amount mutez={baker.delegated} />
            </Cell>
          </div>

          {baker.delegationFreeSpace === 0n && (
            <p className="note note--strong">
              Este baker já está no limite de delegação. Delegar para ele funciona, mas nada do que
              você delegar entra no peso dele — e o que não entra no peso não gera recompensa.
            </p>
          )}
          {baker.overStaked > 0n && (
            <p className="note">
              <Amount mutez={baker.overStaked} /> de stake de terceiros passou do limite deste baker
              e a cadeia já conta esse excedente como delegação. É por isso que o espaço de
              delegação acima é menor do que a capacidade cheia.
            </p>
          )}

          <p className="note note--strong">
            <strong>A comissão do baker sobre delegação não existe na cadeia.</strong> Quem recebe a recompensa da
            delegação é o baker, no saldo dele; quanto ele repassa e quando é combinação dele, fora
            da cadeia, e o Tezzet não tem como verificar. O número abaixo é o teto: tudo que ele
            recebeu por unidade delegada. Você nunca vai receber mais do que isso.
          </p>

          {ceiling.kind === 'unavailable' ? (
            <p className="note">Sem teto para mostrar: {ceiling.reason}.</p>
          ) : (
            <>
              <p className="baker__rate">
                Teto de <strong>{formatRate(ceiling.annualBillionth)} ao ano</strong> (
                {formatRate(ceiling.perCycleBillionth)} por ciclo)
              </p>
              <p className="note">
                A conta: <Amount mutez={ceiling.received} /> caíram no saldo do baker sobre{' '}
                <Amount mutez={ceiling.base} /> delegados, somando os ciclos{' '}
                <span className="t-cycle">{ceiling.cycles.join(', ')}</span>. Anualizado supondo
                todo bloco no tempo mínimo, que é o melhor caso.
              </p>
            </>
          )}
        </section>
      ) : (
        <section className="stack">
          <h3 className="baker__section">Stakear com este baker</h3>
          <div className="balance__split">
            <Cell label="Comissão do baker (cobrada pela cadeia)">
              {formatEdgePercent(baker.stakingEdgeBillionth)}
            </Cell>
            <Cell label="Cabe de stake">
              <Amount mutez={baker.stakingFreeSpace} />
            </Cell>
            <Cell label="Limite que ele aceita">
              {formatStakingLimit(baker.stakingLimitMillionth)} o stake próprio
            </Cell>
            <Cell label="Já em stake de terceiros">
              <Amount mutez={baker.externalStaked} />
            </Cell>
          </div>

          {baker.stakingLimitMillionth === 0n && (
            <p className="note note--strong">
              Este baker <strong>não aceita stake de terceiros</strong>: o limite dele é zero. A
              operação de stake seria recusada pela cadeia.
            </p>
          )}
          {baker.stakingFreeSpace === 0n && baker.stakingLimitMillionth > 0n && (
            <p className="note note--strong">
              Não cabe mais stake neste baker. O que entrasse agora passaria do limite dele e a
              cadeia contaria como delegação, que rende {constants.edgeOfStakingOverDelegation} vezes
              menos.
            </p>
          )}

          <p className="note">
            A comissão acima é cobrada pelo protocolo, na cadeia, antes de o valor chegar até
            você — não é promessa do baker. É a única comissão que o Tezzet consegue verificar.
          </p>

          {stakingYield.kind === 'unavailable' ? (
            <p className="note note--strong">
              <strong>Sem rendimento para mostrar:</strong> {stakingYield.reason}. Um número aqui
              seria inventado.
            </p>
          ) : (
            <>
              <p className="baker__rate">
                Rendeu <strong>{formatRate(stakingYield.annualBillionth)} ao ano</strong> (
                {formatRate(stakingYield.perCycleBillionth)} por ciclo)
              </p>
              <p className="note">
                A conta: a cadeia creditou <Amount mutez={stakingYield.credited} /> a quem stakeia,
                sobre <Amount mutez={stakingYield.base} /> em stake, nos ciclos{' '}
                <span className="t-cycle">{stakingYield.cycles.join(', ')}</span>. Anualizado por{' '}
                {stakingYield.cyclesPerYear.toFixed(1)} ciclos no ano. É passado medido, não
                previsão: a emissão da Tezos muda com quanto da rede está em stake.
              </p>
            </>
          )}
        </section>
      )}

      <section className="stack">
        <h3 className="baker__section">Nos últimos {reliability.cycles} ciclos fechados</h3>
        {reliability.cycles === 0 ? (
          <p className="note">
            O indexador não tem nenhum ciclo fechado deste baker. Sem ciclo não há histórico, e
            histórico ausente não é histórico limpo.
          </p>
        ) : (
          <div className="balance__split">
            <Cell label="Blocos feitos / perdidos">
              {reliability.blocks.toLocaleString('pt-BR')} /{' '}
              {reliability.missedBlocks.toLocaleString('pt-BR')}
            </Cell>
            <Cell label="Atestações feitas / perdidas">
              {reliability.attestations.toLocaleString('pt-BR')} /{' '}
              {reliability.missedAttestations.toLocaleString('pt-BR')}
            </Cell>
            <Cell label="Punição que atingiu quem stakeia">
              <Amount mutez={reliability.lostExternalStake} />
            </Cell>
          </div>
        )}
        {reliability.lostExternalStake > 0n && (
          <p className="note note--strong">
            Este baker já foi punido, e a punição saiu do bolso de quem stakeia com ele. Quem só
            delega não perdeu nada nesse episódio.
          </p>
        )}
      </section>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="balance__cell">
      <span className="balance__label">{label}</span>
      <span className="balance__value">{children}</span>
    </div>
  );
}
