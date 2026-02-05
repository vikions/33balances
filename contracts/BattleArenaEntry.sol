// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Battle Arena Entry
/// @notice Records on-chain match entries without cooldowns.
/// @dev Designed for lightweight analytics + leaderboard building off-chain.
contract BattleArenaEntry {
    uint256 public totalEntries;
    uint256 public totalPlayers;

    mapping(address => uint256) public entriesByPlayer;
    mapping(address => uint256) public lastEntryAt;
    mapping(bytes32 => uint256) public entriesByCharacter;

    event MatchEntered(
        address indexed player,
        string characterId,
        bytes32 indexed characterHash,
        uint256 entryNumber,
        uint256 timestamp
    );

    /// @notice Enter a match with the chosen character id (e.g., "trump").
    function enterMatch(string calldata characterId) external {
        bytes32 characterHash = keccak256(bytes(characterId));

        if (entriesByPlayer[msg.sender] == 0) {
            totalPlayers += 1;
        }

        totalEntries += 1;
        entriesByPlayer[msg.sender] += 1;
        lastEntryAt[msg.sender] = block.timestamp;
        entriesByCharacter[characterHash] += 1;

        emit MatchEntered(
            msg.sender,
            characterId,
            characterHash,
            totalEntries,
            block.timestamp
        );
    }

    /// @notice Get entry count for a character by id.
    function getCharacterEntries(string calldata characterId)
        external
        view
        returns (uint256)
    {
        return entriesByCharacter[keccak256(bytes(characterId))];
    }

    /// @notice Get entry stats for a player.
    function getPlayerStats(address player)
        external
        view
        returns (uint256 entries, uint256 lastEntryTime)
    {
        return (entriesByPlayer[player], lastEntryAt[player]);
    }
}
